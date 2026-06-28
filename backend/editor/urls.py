from django.urls import path
from .views import register, login
from . import views

urlpatterns = [
    path('auth/register/', register),
    path('auth/login/', login),
    path('rooms/', views.list_rooms),

]



