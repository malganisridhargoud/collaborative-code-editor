from rest_framework import serializers
from .models import Room, CodeSession, ActiveUser

class ActiveUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActiveUser
        fields = ['username', 'joined_at']

class CodeSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CodeSession
        fields = ['code', 'language', 'updated_at']

class RoomSerializer(serializers.ModelSerializer):
    active_users = ActiveUserSerializer(many=True, read_only=True)
    session = CodeSessionSerializer(read_only=True)
    user_count = serializers.SerializerMethodField()
    
    class Meta:
        model = Room
        fields = ['id', 'room_id', 'name', 'created_at', 'active_users', 'session', 'user_count']
    
    def get_user_count(self, obj):
        return obj.active_users.count()