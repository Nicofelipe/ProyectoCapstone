from django.urls import path
from rest_framework.routers import DefaultRouter
from .views import (
    LibroViewSet, my_books, my_books_with_history,
    create_book, update_book,
    upload_image, list_images, update_image, delete_image,
    marcar_solicitudes_vistas, delete_book,
    crear_intercambio, responder_intercambio, completar_intercambio,
    solicitudes_entrantes, books_by_title
)

router = DefaultRouter()
router.register(r'libros', LibroViewSet, basename='libros')

urlpatterns = [
    path('books/mine/', my_books, name='my_books'),
    path('books/mine-with-history/', my_books_with_history, name='my_books_with_history'),

    path('libros/create/', create_book, name='create_book'),
    path('libros/<int:libro_id>/update/', update_book, name='update_book'),

    path('libros/<int:libro_id>/images/upload/', upload_image, name='upload_image'),
    path('libros/<int:libro_id>/images/', list_images, name='list_images'),
    path('images/<int:imagen_id>/', update_image, name='update_image'),
    path('images/<int:imagen_id>/delete/', delete_image, name='delete_image'),
    path('libros/<int:libro_id>/solicitudes/vistas/', marcar_solicitudes_vistas, name='marcar_solicitudes_vistas'),
    path('libros/<int:libro_id>/delete/', delete_book, name='delete_book'),
    
    # Intercambios (solicitudes)
    path('intercambios/create/', crear_intercambio),
    path('intercambios/<int:intercambio_id>/responder/', responder_intercambio),
    path('intercambios/<int:intercambio_id>/completar/', completar_intercambio),
    path('intercambios/entrantes/', solicitudes_entrantes),


    path('libros/by-title/', books_by_title),
]

urlpatterns += router.urls



