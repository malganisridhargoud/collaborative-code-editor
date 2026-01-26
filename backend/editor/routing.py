from django.urls import re_path
from .consumers import CodeEditorConsumer

websocket_urlpatterns = [
    re_path(r"ws/code/(?P<room_id>\w+)/$", CodeEditorConsumer.as_asgi()),
]