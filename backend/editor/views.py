from django.contrib.auth.models import User
from django.contrib.auth import authenticate
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

import logging

logger = logging.getLogger(__name__)

from .models import Room
from .serializers import RoomSerializer
from rest_framework.permissions import IsAuthenticated
from rest_framework.decorators import permission_classes


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


@api_view(["GET"])
def list_rooms(request):
    """Return a list of persistent rooms with metadata and session info.

    Public endpoint — adjust permission decorators if you want to restrict access.
    """
    rooms = Room.objects.all().order_by('-created_at')
    serializer = RoomSerializer(rooms, many=True)
    return Response(serializer.data)
