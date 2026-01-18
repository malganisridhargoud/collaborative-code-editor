import json
import asyncio
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async

from .models import Room, CodeSession, ActiveUser
from .code_executor import CodeExecutor


class CodeEditorConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_id = self.scope["url_route"]["kwargs"]["room_id"]
        self.room_group_name = f"code_{self.room_id}"
        self.username = None

        # Join room group
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name,
        )

        await self.accept()
        print(f"WS CONNECT → room={self.room_id}")

    async def disconnect(self, close_code):
        if self.username:
            await self.remove_active_user()

            active_users = await self.get_active_users()
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    "type": "user_left",
                    "username": self.username,
                    "users": active_users,
                },
            )

        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name,
        )

        print(f"WS DISCONNECT → room={self.room_id} user={self.username}")

    async def receive(self, text_data):
        data = json.loads(text_data)
        msg_type = data.get("type")

        if msg_type == "join":
            await self.handle_join(data)

        elif msg_type == "code_update":
            await self.handle_code_update(data)

        elif msg_type == "language_change":
            await self.handle_language_change(data)

        elif msg_type == "compile":
            await self.handle_compile(data)

    # =========================
    # JOIN ROOM
    # =========================
    async def handle_join(self, data):
        self.username = data["username"]  # MUST be unique (email)

        print(f"USER JOIN → {self.username} room={self.room_id}")

        await self.add_active_user()

        code_data = await self.get_current_code()
        active_users = await self.get_active_users()

        # Send initial state ONLY to this user
        await self.send(
            text_data=json.dumps(
                {
                    "type": "init",
                    "code": code_data["code"],
                    "language": code_data["language"],
                    "users": active_users,
                }
            )
        )

        # Notify others
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                "type": "user_joined",
                "username": self.username,
                "users": active_users,
            },
        )

    # =========================
    # CODE UPDATE
    # =========================
    async def handle_code_update(self, data):
        code = data["code"]
        language = data.get("language")

        await self.save_code(code, language)

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                "type": "code_changed",
                "code": code,
                "user": self.username,
                "language": language,
            },
        )

    # =========================
    # LANGUAGE CHANGE
    # =========================
    async def handle_language_change(self, data):
        language = data["language"]
        template_code = data.get("code", "")

        await self.update_language(language, template_code)

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                "type": "language_changed",
                "language": language,
                "code": template_code,
                "user": self.username,
            },
        )

    # =========================
    # COMPILE (BROADCAST RESULT)
    # =========================
    async def handle_compile(self, data):
        language = data.get("language")
        code = data.get("code", "")

        executor = CodeExecutor()

        try:
            output = await asyncio.to_thread(
                executor.execute, code, language
            )
        except Exception as e:
            output = f"Execution Error: {str(e)}"

        # 🔥 BROADCAST OUTPUT TO ENTIRE ROOM
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                "type": "compile_result",
                "output": output,
                "language": language,
                "user": self.username,
            },
        )

    # =========================
    # GROUP EVENT HANDLERS
    # =========================
    async def user_joined(self, event):
        await self.send(
            text_data=json.dumps(
                {
                    "type": "user_joined",
                    "username": event["username"],
                    "users": event["users"],
                }
            )
        )

    async def user_left(self, event):
        await self.send(
            text_data=json.dumps(
                {
                    "type": "user_left",
                    "username": event["username"],
                    "users": event["users"],
                }
            )
        )

    async def code_changed(self, event):
        if event["user"] != self.username:
            await self.send(
                text_data=json.dumps(
                    {
                        "type": "code_update",
                        "code": event["code"],
                        "user": event["user"],
                        "language": event.get("language"),
                    }
                )
            )

    async def language_changed(self, event):
        await self.send(
            text_data=json.dumps(
                {
                    "type": "language_change",
                    "language": event["language"],
                    "code": event["code"],
                    "user": event["user"],
                }
            )
        )

    async def compile_result(self, event):
        await self.send(
            text_data=json.dumps(
                {
                    "type": "compile_result",
                    "output": event["output"],
                    "language": event.get("language"),
                    "user": event.get("user"),
                }
            )
        )

    # =========================
    # DATABASE HELPERS
    # =========================
    @database_sync_to_async
    def add_active_user(self):
        room, _ = Room.objects.get_or_create(room_id=self.room_id)
        ActiveUser.objects.update_or_create(
            room=room,
            username=self.username,
            defaults={"channel_name": self.channel_name},
        )

    @database_sync_to_async
    def remove_active_user(self):
        ActiveUser.objects.filter(
            room__room_id=self.room_id,
            username=self.username,
        ).delete()

    @database_sync_to_async
    def get_active_users(self):
        try:
            room = Room.objects.get(room_id=self.room_id)
            return list(
                room.active_users.values_list("username", flat=True)
            )
        except Room.DoesNotExist:
            return []

    @database_sync_to_async
    def get_current_code(self):
        room, _ = Room.objects.get_or_create(room_id=self.room_id)
        session, _ = CodeSession.objects.get_or_create(
            room=room,
            defaults={
                "code": "// Welcome to CodeSync! Start coding together.",
                "language": "javascript",
            },
        )
        return {
            "code": session.code,
            "language": session.language,
        }

    @database_sync_to_async
    def save_code(self, code, language=None):
        room, _ = Room.objects.get_or_create(room_id=self.room_id)
        session, _ = CodeSession.objects.get_or_create(room=room)
        session.code = code
        if language:
            session.language = language
        session.save()

    @database_sync_to_async
    def update_language(self, language, code=None):
        room, _ = Room.objects.get_or_create(room_id=self.room_id)
        session, _ = CodeSession.objects.get_or_create(room=room)
        session.language = language
        if code is not None:
            session.code = code
        session.save()
