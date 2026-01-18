from django.urls import path
from .views import RoomView

from .views import GoogleLoginView

urlpatterns = [
    path('rooms/', RoomView.as_view(), name='room-create'),
    path('rooms/<str:room_id>/', RoomView.as_view(), name='room-detail'),
     path('auth/google/', GoogleLoginView.as_view()),
]





