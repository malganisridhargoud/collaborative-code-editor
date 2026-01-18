import os
from google.oauth2 import id_token
from google.auth.transport import requests

from django.contrib.auth.models import User
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from rest_framework_simplejwt.tokens import RefreshToken

from .models import Room, CodeSession
from .serializers import RoomSerializer


class GoogleLoginView(APIView):
    def post(self, request):
        token = request.data.get("token")

        if not token:
            return Response(
                {"error": "Token is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            idinfo = id_token.verify_oauth2_token(
                token,
                requests.Request(),
                os.getenv("GOOGLE_CLIENT_ID"),
            )

            email = idinfo.get("email")
            name = idinfo.get("name", "")

            if not email:
                return Response(
                    {"error": "Invalid Google account"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            user, _ = User.objects.get_or_create(
                username=email,
                defaults={
                    "email": email,
                    "first_name": name,
                },
            )

            refresh = RefreshToken.for_user(user)

            return Response(
                {
                    "access": str(refresh.access_token),
                    "refresh": str(refresh),
                    "user": {
                        "email": user.email,
                        "name": user.first_name,
                    },
                }
            )

        except Exception:
            return Response(
                {"error": "Invalid Google token"},
                status=status.HTTP_401_UNAUTHORIZED,
            )


class RoomView(APIView):
    def get(self, request, room_id):
        try:
            room = Room.objects.get(room_id=room_id)
            session = CodeSession.objects.get(room=room)

            return Response(
                {
                    "room": RoomSerializer(room).data,
                    "code": session.code,
                    "language": session.language,
                }
            )
        except Room.DoesNotExist:
            return Response(
                {"error": "Room not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

    def post(self, request):
        room_id = request.data.get("room_id")

        if not room_id:
            return Response(
                {"error": "room_id required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        room, created = Room.objects.get_or_create(room_id=room_id)

        if created:
            CodeSession.objects.create(
                room=room,
                code="// Welcome to CodeSync!",
                language="javascript",
            )

        return Response(
            RoomSerializer(room).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )
