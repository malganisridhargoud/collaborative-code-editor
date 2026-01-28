import os
from django.core.asgi import get_asgi_application

# Set the settings module
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

# Initialize Django FIRST
django_asgi_app = get_asgi_application()

# NOW import everything else AFTER Django is initialized
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
import editor.routing

# Configure the application
application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": AuthMiddlewareStack(
        URLRouter(editor.routing.websocket_urlpatterns)
    ),
})
