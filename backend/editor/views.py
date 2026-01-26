from django.contrib.auth.models import User
from django.contrib.auth import authenticate
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from rest_framework_simplejwt.tokens import RefreshToken

import os
import requests

from django.http import JsonResponse, HttpResponseRedirect
from django.views.decorators.csrf import csrf_exempt
from django.shortcuts import redirect
from urllib.parse import urlencode


FRONTEND_URL = "http://localhost:3000"  # change in prod


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

    User.objects.create_user(
        username=email,
        email=email,
        password=password
    )

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
        "user": {
            "email": user.email
        }
    })


# =========================
# GitHub OAuth
# =========================

GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET")


def github_login(request):
    """Redirect user to GitHub OAuth"""
    github_auth_url = (
        "https://github.com/login/oauth/authorize"
        f"?client_id={GITHUB_CLIENT_ID}"
        "&scope=user:email"
    )
    return HttpResponseRedirect(github_auth_url)


@csrf_exempt
def github_callback(request):
    """GitHub redirects here with ?code="""

    code = request.GET.get("code")
    if not code:
        return JsonResponse({"error": "Missing code"}, status=400)

    # 1️⃣ Exchange code → GitHub access token
    token_res = requests.post(
        "https://github.com/login/oauth/access_token",
        headers={"Accept": "application/json"},
        data={
            "client_id": GITHUB_CLIENT_ID,
            "client_secret": GITHUB_CLIENT_SECRET,
            "code": code,
        },
    ).json()

    github_token = token_res.get("access_token")
    if not github_token:
        return JsonResponse({"error": "Token exchange failed"}, status=400)

    # 2️⃣ Fetch GitHub user
    user_res = requests.get(
        "https://api.github.com/user",
        headers={"Authorization": f"Bearer {github_token}"},
    ).json()

    email = user_res.get("email")

    # 3️⃣ Email may be private → fetch emails API
    if not email:
        emails_res = requests.get(
            "https://api.github.com/user/emails",
            headers={"Authorization": f"Bearer {github_token}"},
        ).json()

        primary = next((e for e in emails_res if e.get("primary")), None)
        email = primary["email"] if primary else None

    if not email:
        return JsonResponse({"error": "Email not available"}, status=400)

    # 4️⃣ Create or get user
    user, _ = User.objects.get_or_create(
        username=email,
        defaults={"email": email},
    )

    # 5️⃣ ISSUE JWT (🔥 THIS WAS MISSING BEFORE)
    refresh = RefreshToken.for_user(user)
    access = refresh.access_token   # ✅ FIXED

    # 6️⃣ Redirect to frontend with token
    params = urlencode({
        "access": str(access),
        "email": user.email
    })

    return redirect(f"{FRONTEND_URL}/oauth-success?{params}")