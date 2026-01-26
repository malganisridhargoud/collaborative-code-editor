import json
import asyncio
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from .models import Room, CodeSession, ActiveUser
from .code_executor import CodeExecutor

class CodeEditorConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_id = self.scope['url_route']['kwargs']['room_id']
        self.room_group_name = f'code_{self.room_id}'
        self.username = None

        # Join channel layer group for room
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if self.username:
            await self.remove_active_user()
            active_users = await self.get_active_users()

            # Notify room that user left
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'user_left',           # -> user_left()
                    'username': self.username,
                    'users': active_users,
                }
            )

        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive(self, text_data):
        data = json.loads(text_data)
        message_type = data.get('type')

        if message_type == 'join':
            await self.handle_join(data)
        elif message_type == 'code_update':
            await self.handle_code_update(data)
        elif message_type == 'language_change':
            await self.handle_language_change(data)
        elif message_type == 'compile':
            await self.handle_compile(data)
        elif message_type == 'clear_output':
            await self.handle_clear_output(data)
        else:
            # unknown message type - ignore
            pass

    # ----------------------------
    # Handlers for incoming client events
    # ----------------------------
    async def handle_join(self, data):
        self.username = data.get('username')
        await self.add_active_user()

        code_data = await self.get_current_code()
        active_users = await self.get_active_users()

        # Send init only to joining socket
        await self.send(text_data=json.dumps({
            'type': 'init',
            'code': code_data['code'],
            'language': code_data['language'],
            'users': active_users
        }))

        # Broadcast join to everyone in room
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'user_joined',   # -> user_joined()
                'username': self.username,
                'users': active_users
            }
        )

    async def handle_code_update(self, data):
        code = data.get('code', '')
        username = data.get('user', self.username)
        language = data.get('language')

        await self.save_code(code, language)

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'code_changed',   # -> code_changed()
                'code': code,
                'user': username,
                'language': language
            }
        )

    async def handle_language_change(self, data):
        language = data.get('language')
        template_code = data.get('code', '')
        username = data.get('user', self.username)

        await self.update_language(language, template_code)

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'language_changed',   # -> language_changed()
                'language': language,
                'code': template_code,
                'user': username
            }
        )

    async def handle_compile(self, data):
        language = data.get('language')
        code = data.get('code', '')
        username = data.get('user', self.username)

        executor = CodeExecutor()

        try:
            # execute on thread pool to avoid blocking event loop
            output = await asyncio.to_thread(executor.execute, code, language)
        except Exception as e:
            output = f"Execution Error: {str(e)}"

        # BROADCAST compile result to whole room so everyone sees output
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'compile_result',   # -> compile_result()
                'output': output,
                'language': language,
                'user': username
            }
        )

    async def handle_clear_output(self, data):
        username = data.get('user', self.username)

        # Broadcast output cleared to everyone in the room
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'output_cleared',   # -> output_cleared()
                'user': username
            }
        )

    # ----------------------------
    # Group event handlers (called by Channels when group_send is used)
    # All of these send JSON messages to the WebSocket clients.
    # ----------------------------
    async def user_joined(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_joined',
            'username': event.get('username'),
            'users': event.get('users', [])
        }))

    async def user_left(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_left',
            'username': event.get('username'),
            'users': event.get('users', [])
        }))

    async def code_changed(self, event):
        # send code updates to all clients (clients can ignore if user == self.username)
        await self.send(text_data=json.dumps({
            'type': 'code_update',
            'code': event.get('code', ''),
            'user': event.get('user'),
            'language': event.get('language')
        }))

    async def language_changed(self, event):
        await self.send(text_data=json.dumps({
            'type': 'language_change',
            'language': event.get('language'),
            'code': event.get('code', ''),
            'user': event.get('user')
        }))

    async def compile_result(self, event):
        # broadcasted compile result - everyone receives
        await self.send(text_data=json.dumps({
            'type': 'compile_result',
            'output': event.get('output', ''),
            'language': event.get('language'),
            'user': event.get('user')
        }))

    async def output_cleared(self, event):
        await self.send(text_data=json.dumps({
            'type': 'output_cleared',
            'user': event.get('user')
        }))

    # ----------------------------
    # Database helpers (run in thread pool via database_sync_to_async)
    # ----------------------------
    @database_sync_to_async
    def add_active_user(self):
        room, _ = Room.objects.get_or_create(room_id=self.room_id)
        ActiveUser.objects.update_or_create(
            room=room,
            username=self.username,
            defaults={'channel_name': self.channel_name}
        )

    @database_sync_to_async
    def remove_active_user(self):
        try:
            ActiveUser.objects.filter(
                room__room_id=self.room_id,
                username=self.username
            ).delete()
        except Exception as e:
            # don't let DB errors crash consumer
            print(f"Error removing user: {e}")

    @database_sync_to_async
    def get_active_users(self):
        try:
            room = Room.objects.get(room_id=self.room_id)
            return list(room.active_users.values_list('username', flat=True))
        except Room.DoesNotExist:
            return []

    @database_sync_to_async
    def get_current_code(self):
        room, _ = Room.objects.get_or_create(room_id=self.room_id)
        session, _ = CodeSession.objects.get_or_create(
            room=room,
            defaults={
                'code': '// Welcome to CodeSync! Start coding together.',
                'language': 'javascript'
            }
        )
        return {
            'code': session.code,
            'language': session.language
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