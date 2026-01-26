from django.urls import path
from .views import register, login
from . import views

urlpatterns = [
    path('auth/register/', register),
    path('auth/login/', login),
    path("auth/github/login/", views.github_login),
    path("auth/github/callback/", views.github_callback),

]



