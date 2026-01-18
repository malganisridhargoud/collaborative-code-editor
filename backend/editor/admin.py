from django.contrib import admin
from .models import Room, CodeSession, ActiveUser

@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ['room_id', 'name', 'created_at', 'get_active_users_count']
    search_fields = ['room_id', 'name']
    
    def get_active_users_count(self, obj):
        return obj.active_users.count()
    get_active_users_count.short_description = 'Active Users'

@admin.register(CodeSession)
class CodeSessionAdmin(admin.ModelAdmin):
    list_display = ['room', 'language', 'updated_at']
    list_filter = ['language']

@admin.register(ActiveUser)
class ActiveUserAdmin(admin.ModelAdmin):
    list_display = ['username', 'room', 'joined_at']
    list_filter = ['joined_at']