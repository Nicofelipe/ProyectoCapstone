# market/urls.py
from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views
from market import views as market_views
from .views import (
    # ViewSet
    LibroViewSet,

    # Libros propios + CRUD + imágenes
    my_books, my_books_with_history,
    create_book, update_book, delete_book,
    upload_image, list_images, update_image, delete_image,
    marcar_solicitudes_vistas, books_by_title, catalog_generos,
    owner_toggle,

    # Favoritos
    favoritos_list, favoritos_check, favoritos_toggle,

    # Solicitudes / Intercambios
    crear_solicitud_intercambio, listar_solicitudes_recibidas, listar_solicitudes_enviadas,
    aceptar_solicitud, rechazar_solicitud, cancelar_solicitud,
    libros_ofrecidos_ocupados,
    proponer_encuentro, confirmar_encuentro, propuesta_actual,
    generar_codigo, completar_intercambio, cancelar_intercambio,
    calificar_intercambio, mi_calificacion,

    # Puntos de encuentro
    puntos_encuentro,

    # Chat
    lista_conversaciones, mensajes_de_conversacion, enviar_mensaje, marcar_visto,

    admin_dar_baja_libro,
)

app_name = "market"

router = DefaultRouter()
router.register(r'libros', LibroViewSet, basename='libros')  # basename coherente

urlpatterns = [
    # ===== Libros propios / historial =====
    path('books/mine/', my_books, name='my_books'),
    path('books/mine-with-history/', my_books_with_history, name='my_books_with_history'),

    # ===== Libros: CRUD + owner toggle =====
    path('libros/create/', create_book, name='create_book'),
    path('libros/<int:libro_id>/update/', update_book, name='update_book'),
    path('libros/<int:libro_id>/delete/', delete_book, name='delete_book'),
    path('libros/<int:libro_id>/owner-toggle/', owner_toggle, name='owner_toggle'),

    # ===== Imágenes de libro =====
    path('libros/<int:libro_id>/images/upload/', upload_image, name='upload_image'),
    path('libros/<int:libro_id>/images/', list_images, name='list_images'),
    path('images/<int:imagen_id>/', update_image, name='update_image'),
    path('images/<int:imagen_id>/delete/', delete_image, name='delete_image'),
    path('libros/<int:libro_id>/solicitudes/vistas/', marcar_solicitudes_vistas, name='marcar_solicitudes_vistas'),

    # ===== Catálogo / búsqueda =====
    path('catalog/generos/', catalog_generos, name='catalog_generos'),
    path('libros/by-title/', books_by_title, name='books_by_title'),

    # ===== Favoritos =====
    path('favoritos/', favoritos_list, name='favoritos_list'),
    path('favoritos/<int:libro_id>/check/', favoritos_check, name='favoritos_check'),
    path('favoritos/<int:libro_id>/toggle/', favoritos_toggle, name='favoritos_toggle'),
    # Aliases retro-compatibles:
    path('libros/<int:libro_id>/favorito/check/', favoritos_check),
    path('libros/<int:libro_id>/favorito/toggle/', favoritos_toggle),


    # ===== Solicitudes de intercambio =====
    path('solicitudes/crear/', crear_solicitud_intercambio, name='solicitud_crear'),
    path('solicitudes/recibidas/', listar_solicitudes_recibidas, name='solicitudes_recibidas'),
    path('solicitudes/enviadas/', listar_solicitudes_enviadas, name='solicitudes_enviadas'),
    path('solicitudes/<int:solicitud_id>/aceptar/', aceptar_solicitud, name='solicitud_aceptar'),
    path('solicitudes/<int:solicitud_id>/rechazar/', rechazar_solicitud, name='solicitud_rechazar'),
    path('solicitudes/<int:solicitud_id>/cancelar/', cancelar_solicitud, name='solicitud_cancelar'),
    path('solicitudes/ofertas-ocupadas/', libros_ofrecidos_ocupados, name='libros_ofrecidos_ocupados'),

    # ===== Intercambios (propuestas, código, completar, cancelar, calificación) =====
    path('intercambios/<int:intercambio_id>/proponer/', proponer_encuentro, name='proponer_encuentro'),
    path('intercambios/<int:intercambio_id>/confirmar/', confirmar_encuentro, name='confirmar_encuentro'),
    path('intercambios/<int:intercambio_id>/propuesta/', propuesta_actual, name='propuesta_actual'),
    path('intercambios/<int:intercambio_id>/codigo/', generar_codigo, name='generar_codigo'),
    path('intercambios/<int:intercambio_id>/completar/', completar_intercambio, name='completar_intercambio'),
    path('intercambios/<int:intercambio_id>/cancelar/', cancelar_intercambio, name='cancelar_intercambio'),
    path('intercambios/<int:intercambio_id>/calificar/', calificar_intercambio, name='calificar_intercambio'),
    path('intercambios/<int:intercambio_id>/mi-calificacion/', mi_calificacion, name='mi_calificacion'),
    path("solicitudes/resumen/", views.resumen_solicitudes, name="solicitudes-resumen"),
    path("solicitudes/marcar-listado-visto/", views.marcar_listado_solicitudes_visto, name="solicitudes-marcar-visto"),

    # ===== Puntos de encuentro =====
    path('puntos-encuentro/', puntos_encuentro, name='puntos_encuentro'),

    # ===== Chat =====
    path('chat/<int:user_id>/conversaciones/', lista_conversaciones, name='lista_conversaciones'),
    path('chat/conversacion/<int:conversacion_id>/mensajes/', mensajes_de_conversacion, name='mensajes_de_conversacion'),
    path('chat/conversacion/<int:conversacion_id>/enviar/', enviar_mensaje, name='enviar_mensaje'),
    path('chat/conversacion/<int:conversacion_id>/visto/', marcar_visto, name='marcar_visto'),

    path('libros/por-genero/', views.libros_por_genero, name='libros_por_genero'),
    path('libros/catalogo/', views.catalogo_completo, name='catalogo-completo'),

    path("reportes-publicacion/", market_views.crear_reporte_publicacion, name="crear_reporte_publicacion"),
    path("reportes-publicacion/mios/", market_views.mis_reportes_publicacion, name="mis_reportes_publicacion"),

    # Admin – moderación de reportes
    path("admin/reportes-publicacion/", market_views.admin_listar_reportes_publicacion, name="admin_listar_reportes_publicacion"),
    path("admin/reportes-publicacion/<int:reporte_id>/resolver/",market_views.admin_resolver_reporte_publicacion,name="admin_resolver_reporte_publicacion"),
    path( "libros/<int:libro_id>/reportar/", market_views.reportar_publicacion, name="reportar_publicacion",),
     path("admin/libros/<int:libro_id>/dar-baja/",admin_dar_baja_libro, name="admin_dar_baja_libro",),
]

# DRF router (ViewSet /libros/…)
urlpatterns += router.urls
