import json
import asyncio
import logging

from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async

from .models import Room, CodeSession, ActiveUser
from .code_executor import CodeExecutor

logger = logging.getLogger(__name__)
logger = logging.getLogger('editor')

class CodeEditorConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_id = self.scope.get('url_route', {}).get('kwargs', {}).get('room_id')
        self.room_group_name = f'code_{self.room_id}' if self.room_id else None
        self.username = None

        try:
            logger.info("WebSocket connect requested: room=%s channel=%s", self.room_id, getattr(self, 'channel_name', None))
            # Join channel layer group for room
            await self.channel_layer.group_add(self.room_group_name, self.channel_name)
            await self.accept()
            logger.info("WebSocket accepted: room=%s channel=%s group=%s", self.room_id, self.channel_name, self.room_group_name)
        except Exception:
            logger.exception("Error during WebSocket connect for room %s", self.room_id)
            await self.close()
            # Reject connection
            await self.close()

    async def disconnect(self, close_code):
        logger.info(
            "WebSocket disconnect: room=%s channel=%s close_code=%s username=%s", 
            getattr(self, 'room_id', None), 
            getattr(self, 'channel_name', None), 
            close_code, 
            getattr(self, 'username', None)
        )

        # Never let disconnect path crash the consumer; that can look like random disconnect loops.
        try:
            if getattr(self, 'username', None) and self.room_group_name:
                await self.remove_active_user()
                # If the leaving user was the owner, transfer ownership
                await self.transfer_owner_if_needed(self.username)
                active_users = await self.get_active_users()

                # Notify room that user left
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'user_left',
                        'username': self.username,
                        'users': active_users,
                    },
                )
        except Exception:
            logger.exception("Error during disconnect cleanup for user %s in room %s", self.username, getattr(self, 'room_id', None))

        try:
            if self.room_group_name:
                await self.channel_layer.group_discard(self.room_group_name, self.channel_name)
        except Exception:
            logger.exception("Error discarding channel from group: %s %s", getattr(self, 'room_group_name', None), getattr(self, 'channel_name', None))


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
        elif message_type == 'cursor_move':
            await self.handle_cursor_move(data)
        elif message_type == 'kick_user':
            await self.handle_kick_user(data)
        elif message_type == 'lock_room':
            await self.handle_lock_room(data)
        elif message_type == 'delete_room':
            await self.handle_delete_room(data)
        else:
            # unknown message type - ignore
            logger.debug("Unknown message type received: %s", message_type)

    # ----------------------------
    # Handlers for incoming client events
    # ----------------------------
    async def handle_join(self, data):
        self.username = data.get('username')

        # check locked state before joining
        locked, owner = await self.get_room_locked_and_owner()
        if locked and owner and owner != self.username:
            # room is locked and this user is not the owner
            await self.send(text_data=json.dumps({'type': 'room_locked'}))
            await self.close()
            return

        await self.add_active_user()

        code_data = await self.get_current_code()
        active_users = await self.get_active_users()

        # room info
        room_locked, room_owner = await self.get_room_locked_and_owner()

        # Send init only to joining socket
        await self.send(text_data=json.dumps({
            'type': 'init',
            'code': code_data['code'],
            'language': code_data['language'],
            'users': active_users,
            'owner': room_owner,
            'locked': room_locked,
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
            logger.exception("Error executing code for user %s", username)
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

    async def handle_cursor_move(self, data):
        cursor = data.get('cursor')
        username = data.get('user', self.username)

        # Broadcast cursor position to the room
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'cursor_moved',
                'user': username,
                'cursor': cursor,
            }
        )

    async def handle_kick_user(self, data):
        target = data.get('target')
        requester = data.get('user', self.username)

        # Only owner can kick
        owner = await self.get_room_owner()
        if owner != requester:
            await self.send(text_data=json.dumps({'type': 'error', 'message': 'permission_denied'}))
            return

        # find the target channel and notify it
        target_channel = await self.get_channel_for_user(target)
        if target_channel:
            # tell the target to disconnect
            await self.channel_layer.send(target_channel, {
                'type': 'kick',
                'reason': f'Kicked by {requester}'
            })

        # remove from active users list and broadcast updated list
        await self.remove_user_by_name(target)
        # if kicked user was owner, transfer ownership
        await self.transfer_owner_if_needed(target)
        users = await self.get_active_users()
        await self.channel_layer.group_send(self.room_group_name, {
            'type': 'user_kicked',
            'target': target,
            'users': users,
        })

    async def handle_lock_room(self, data):
        requester = data.get('user', self.username)
        lock = data.get('lock', True)

        owner = await self.get_room_owner()
        if owner != requester:
            await self.send(text_data=json.dumps({'type': 'error', 'message': 'permission_denied'}))
            return

        await self.set_room_locked(lock)
        await self.channel_layer.group_send(self.room_group_name, {
            'type': 'room_locked_state',
            'locked': lock,
            'user': requester,
        })

    async def handle_delete_room(self, data):
        requester = data.get('user', self.username)
        owner = await self.get_room_owner()
        if owner != requester:
            await self.send(text_data=json.dumps({'type': 'error', 'message': 'permission_denied'}))
            return

        # notify clients the room is being deleted
        await self.channel_layer.group_send(self.room_group_name, {
            'type': 'room_deleted',
            'user': requester,
        })

        # delete from DB
        await self.delete_room_db()

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

    async def user_kicked(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_kicked',
            'target': event.get('target'),
            'users': event.get('users', [])
        }))

    async def cursor_moved(self, event):
        await self.send(text_data=json.dumps({
            'type': 'cursor_move',
            'user': event.get('user'),
            'cursor': event.get('cursor')
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

    async def room_locked_state(self, event):
        await self.send(text_data=json.dumps({
            'type': 'room_locked',
            'locked': event.get('locked', False),
            'user': event.get('user')
        }))

    async def room_deleted(self, event):
        await self.send(text_data=json.dumps({
            'type': 'room_deleted',
            'user': event.get('user')
        }))

    async def kick(self, event):
        # Sent directly to a channel to force disconnect
        reason = event.get('reason', '')
        try:
            await self.send(text_data=json.dumps({'type': 'kicked', 'reason': reason}))
        finally:
            await self.close()

    # ----------------------------
    # Database helpers (run in thread pool via database_sync_to_async)
    # ----------------------------
    @database_sync_to_async
    def add_active_user(self):
        room, created = Room.objects.get_or_create(room_id=self.room_id)
        # set owner to first user if room has no owner
        if (created or not room.owner_username) and self.username:
            room.owner_username = self.username
            room.save()

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
    def remove_user_by_name(self, username):
        try:
            ActiveUser.objects.filter(room__room_id=self.room_id, username=username).delete()
        except Exception:
            pass

    @database_sync_to_async
    def get_channel_for_user(self, username):
        try:
            au = ActiveUser.objects.filter(room__room_id=self.room_id, username=username).first()
            return au.channel_name if au else None
        except Exception:
            return None

    @database_sync_to_async
    def get_room_owner(self):
        try:
            room = Room.objects.get(room_id=self.room_id)
            return room.owner_username
        except Room.DoesNotExist:
            return None

    @database_sync_to_async
    def get_room_locked_and_owner(self):
        try:
            room = Room.objects.get(room_id=self.room_id)
            return room.locked, room.owner_username
        except Room.DoesNotExist:
            return False, None

    @database_sync_to_async
    def set_room_locked(self, locked):
        try:
            room = Room.objects.get(room_id=self.room_id)
            room.locked = bool(locked)
            room.save()
        except Room.DoesNotExist:
            pass

    @database_sync_to_async
    def delete_room_db(self):
        try:
            Room.objects.filter(room_id=self.room_id).delete()
        except Exception:
            pass

    @database_sync_to_async
    def transfer_owner_if_needed(self, prev_owner_username):
        try:
            room = Room.objects.get(room_id=self.room_id)
            # if the room owner is not the user who left, nothing to do
            if room.owner_username != prev_owner_username:
                return room.owner_username

            # pick the next active user (earliest joined)
            next_user = room.active_users.order_by('joined_at').first()
            if next_user:
                room.owner_username = next_user.username
            else:
                room.owner_username = None
            room.save()
            return room.owner_username
        except Room.DoesNotExist:
            return None

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
                'code': '// Welcome to CoDe KnOt! Start coding together.',
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