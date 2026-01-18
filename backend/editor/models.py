from django.db import models

class Room(models.Model):
    room_id = models.CharField(max_length=100, unique=True, db_index=True)
    name = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return self.room_id
    
    class Meta:
        ordering = ['-created_at']

class CodeSession(models.Model):
    room = models.OneToOneField(Room, on_delete=models.CASCADE, related_name='session')
    code = models.TextField(default='')
    language = models.CharField(max_length=50, default='javascript')
    updated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return f"Session for {self.room.room_id}"

class ActiveUser(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name='active_users')
    username = models.CharField(max_length=100)
    channel_name = models.CharField(max_length=255)
    joined_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = ['room', 'username']
        ordering = ['joined_at']
    
    def __str__(self):
        return f"{self.username} in {self.room.room_id}"