from django.urls import path
from rest_framework.routers import DefaultRouter
from . import views
from .views import (
    LibroViewSet, my_books, my_books_with_history,
    create_book, update_book,
    upload_image, list_images, update_image, delete_image,
    marcar_solicitudes_vistas, delete_book,
    books_by_title, lista_conversaciones,
    mensajes_de_conversacion, enviar_mensaje, marcar_visto, catalog_generos,
    crear_solicitud_intercambio, listar_solicitudes_recibidas, listar_solicitudes_enviadas,
    aceptar_solicitud, rechazar_solicitud, proponer_encuentro, confirmar_encuentro,
    generar_codigo, completar_intercambio, cancelar_solicitud, cancelar_intercambio,
    libros_ofrecidos_ocupados,calificar_intercambio, mi_calificacion, favoritos_check, favoritos_toggle, favoritos_list
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
    path('catalog/generos/', catalog_generos, name='catalog-generos'),
    
    # --- NUEVAS URLs PARA SOLICITUDES ---
    path('solicitudes/crear/', views.crear_solicitud_intercambio, name='solicitud-crear'),
    path('solicitudes/recibidas/', views.listar_solicitudes_recibidas, name='solicitudes-recibidas'),
    path('solicitudes/enviadas/', views.listar_solicitudes_enviadas, name='solicitudes-enviadas'),
    path('solicitudes/<int:solicitud_id>/aceptar/', views.aceptar_solicitud, name='solicitud-aceptar'),
    path('solicitudes/<int:solicitud_id>/rechazar/', views.rechazar_solicitud, name='solicitud-rechazar'),
    path('solicitudes/ofertas-ocupadas/', libros_ofrecidos_ocupados),

    # --- URLs ANTIGUAS (coméntalas o elimínalas) ---
    # path('intercambios/create/', crear_intercambio),
    # path('intercambios/<int:intercambio_id>/responder/', responder_intercambio),
    # path('intercambios/<int:intercambio_id>/completar/', completar_intercambio),
    # path('intercambios/entrantes/', solicitudes_entrantes),

     # Chats
    path('chat/<int:user_id>/conversaciones/', lista_conversaciones),        # 👈 FALTABA
    path('chat/conversacion/<int:conversacion_id>/mensajes/', mensajes_de_conversacion),
    path('chat/conversacion/<int:conversacion_id>/enviar/',   enviar_mensaje),
    path('chat/conversacion/<int:conversacion_id>/visto/',    marcar_visto), # 👈 recomendable agregar

    #COMPLETAR INTERCAMBIO
    path('intercambios/<int:intercambio_id>/proponer/', proponer_encuentro),
    path('intercambios/<int:intercambio_id>/confirmar/', confirmar_encuentro),
    path('intercambios/<int:intercambio_id>/codigo/', generar_codigo),
    path('intercambios/<int:intercambio_id>/completar/', completar_intercambio),
    path('solicitudes/<int:solicitud_id>/cancelar/', cancelar_solicitud),
    path('intercambios/<int:intercambio_id>/cancelar/', cancelar_intercambio),
    path('intercambios/<int:intercambio_id>/calificar/', calificar_intercambio),
    path('intercambios/<int:intercambio_id>/mi-calificacion/', mi_calificacion),


# ===== Favoritos =====
    # GET    /favoritos/?user_id=123                       → listado de favoritos del usuario (cards)
    # GET    /libros/<libro_id>/favorito/check/?user_id=…  → bool si ese libro está en favoritos del user
    # POST   /libros/<libro_id>/favorito/toggle/           → body: {"user_id": 123}
    path("favoritos/", views.favoritos_list, name="favoritos-list"),
    path("favoritos/<int:libro_id>/check/", views.favoritos_check, name="favoritos-check"),
    path("favoritos/<int:libro_id>/toggle/", views.favoritos_toggle, name="favoritos-toggle"),

    # (Opcional) aliases retro-compatibles si antes llamabas /api/libros/.../favorito/...
    path("libros/<int:libro_id>/favorito/check/", views.favoritos_check),
    path("libros/<int:libro_id>/favorito/toggle/", views.favoritos_toggle),

    path('libros/by-title/', books_by_title),
]

urlpatterns += router.urls



