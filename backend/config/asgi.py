import os
from django.core.asgi import get_asgi_application

# Set the settings module
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

# Initialize Django FIRST
django_asgi_app = get_asgi_application()

# NOW import everything else AFTER Django is initialized
from channels.routing import ProtocolTypeRouter, URLRouter
import editor.routing

# Configure the application
# WebSockets in this app do not require cookie-based auth for basic room sync.
# Using AuthMiddlewareStack here can cause disconnects if session/cookies middleware
# isn't configured/available in some deployments.
from channels.routing import ProtocolTypeRouter, URLRouter

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    # This app doesn't rely on cookie/session auth for room sync.
    # Avoid importing CookieSessionMiddleware (not available in older/newer Channels versions).
    "websocket": URLRouter(editor.routing.websocket_urlpatterns),
})


