from django.contrib.auth.models import User
from django.contrib.auth import authenticate
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken
from django.conf import settings

import os
import secrets
import requests

from django.http import JsonResponse, HttpResponseRedirect
from django.views.decorators.csrf import csrf_exempt
from django.shortcuts import redirect
from urllib.parse import urlencode


# =========================
# Email / Password Auth
# =========================

@api_view(["POST"])
def register(request):
    email = request.data.get("email")
    password = request.data.get("password")

    if not email or not password:
        return Response({"error": "Email and password required"}, status=400)

    if User.objects.filter(username=email).exists():
        return Response({"error": "User already exists"}, status=400)

    User.objects.create_user(username=email, email=email, password=password)
    return Response({"message": "User registered successfully"}, status=201)


@api_view(["POST"])
def login(request):
    email = request.data.get("email")
    password = request.data.get("password")

    user = authenticate(username=email, password=password)
    if not user:
        return Response({"error": "Invalid credentials"}, status=401)

    refresh = RefreshToken.for_user(user)
    return Response({
        "access": str(refresh.access_token),
        "user": {"email": user.email},
    })


# =========================
# GitHub OAuth
# =========================

GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET")


def github_login(request):
    """Redirect user to GitHub OAuth."""
    if not GITHUB_CLIENT_ID or not GITHUB_CLIENT_SECRET:
        return JsonResponse({"error": "GitHub OAuth is not configured"}, status=500)

    frontend_url = request.GET.get("next") or settings.FRONTEND_URL
    request.session["oauth_frontend_url"] = frontend_url.rstrip("/")

    state = secrets.token_urlsafe(24)
    request.session["github_oauth_state"] = state

    redirect_uri = (settings.GITHUB_REDIRECT_URI or "").strip()
    query = {
        "client_id": GITHUB_CLIENT_ID,
        "scope": "user:email",
        "state": state,
    }
    if redirect_uri:
        query["redirect_uri"] = redirect_uri

    github_auth_url = "https://github.com/login/oauth/authorize?" + urlencode(query)
    return HttpResponseRedirect(github_auth_url)


@csrf_exempt
def github_callback(request):
    """GitHub redirects here with ?code="""
    if request.GET.get("error"):
        return JsonResponse(
            {"error": request.GET.get("error_description") or request.GET.get("error")},
            status=400,
        )

    state = request.GET.get("state")
    expected_state = request.session.pop("github_oauth_state", None)
    if not state or state != expected_state:
        return JsonResponse({"error": "Invalid OAuth state"}, status=400)

    code = request.GET.get("code")
    if not code:
        return JsonResponse({"error": "Missing code"}, status=400)

    redirect_uri = (settings.GITHUB_REDIRECT_URI or "").strip()

    # 1. Exchange code to GitHub access token.
    try:
        token_data = {
            "client_id": GITHUB_CLIENT_ID,
            "client_secret": GITHUB_CLIENT_SECRET,
            "code": code,
        }
        if redirect_uri:
            token_data["redirect_uri"] = redirect_uri

        token_http = requests.post(
            "https://github.com/login/oauth/access_token",
            headers={"Accept": "application/json"},
            data=token_data,
            timeout=10,
        )
    except requests.RequestException:
        return JsonResponse({"error": "Unable to reach GitHub token endpoint"}, status=502)

    try:
        token_res = token_http.json()
    except ValueError:
        return JsonResponse(
            {
                "error": "GitHub token endpoint returned non-JSON response",
                "status_code": token_http.status_code,
                "response": token_http.text[:300],
            },
            status=502,
        )

    github_token = token_res.get("access_token")
    if not github_token:
        return JsonResponse(
            {
                "error": token_res.get("error_description") or "Token exchange failed",
                "github_error": token_res.get("error"),
                "status_code": token_http.status_code,
                "used_redirect_uri": redirect_uri or "(not sent)",
            },
            status=400,
        )

    # 2. Fetch GitHub user.
    try:
        user_res = requests.get(
            "https://api.github.com/user",
            headers={
                "Authorization": f"token {github_token}",
                "Accept": "application/vnd.github+json",
            },
            timeout=10,
        ).json()
    except requests.RequestException:
        return JsonResponse({"error": "Unable to fetch GitHub user"}, status=502)

    email = user_res.get("email")

    # 3. Email may be private; fetch emails API.
    if not email:
        try:
            emails_res = requests.get(
                "https://api.github.com/user/emails",
                headers={
                    "Authorization": f"token {github_token}",
                    "Accept": "application/vnd.github+json",
                },
                timeout=10,
            ).json()
        except requests.RequestException:
            return JsonResponse({"error": "Unable to fetch GitHub email"}, status=502)

        primary = next((e for e in emails_res if e.get("primary")), None)
        email = primary["email"] if primary else None

    if not email:
        return JsonResponse({"error": "Email not available"}, status=400)

    # 4. Create or get user and issue JWT.
    user, _ = User.objects.get_or_create(username=email, defaults={"email": email})
    refresh = RefreshToken.for_user(user)
    access = refresh.access_token

    params = urlencode({"access": str(access), "email": user.email})
    frontend_url = request.session.pop("oauth_frontend_url", settings.FRONTEND_URL).rstrip("/")
    return redirect(f"{frontend_url}/?{params}")
