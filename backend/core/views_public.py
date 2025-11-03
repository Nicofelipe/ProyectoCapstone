# core/views_public.py
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from django.conf import settings

class PublicConfigView(APIView):
    permission_classes = [AllowAny]
    def get(self, request):
        return Response({
            "mapsApiKey": settings.GOOGLE_MAPS_API_KEY,
            "apiBase": request.build_absolute_uri("/api/").rstrip("/"),
        })
