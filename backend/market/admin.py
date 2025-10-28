# market/admin.py

from django.contrib import admin
from .models import (
    Intercambio, IntercambioCodigo, SolicitudIntercambio, SolicitudOferta, Libro, Genero, Calificacion, Favorito, ImagenLibro # Importamos los nuevos modelos
)
# Ya no necesitamos importar el modelo 'Intercambio' si lo vamos a eliminar

# ---- Registros básicos (se mantienen igual) ----
admin.site.register(Genero)
admin.site.register(Favorito)


# ---- Configuraciones de Admin Mejoradas ----

class ImagenLibroInline(admin.TabularInline):
    model = ImagenLibro
    fk_name = "id_libro"
    extra = 0
    fields = ("url_imagen", "descripcion", "orden", "is_portada")

@admin.register(Libro)
class LibroAdmin(admin.ModelAdmin):
    list_display = ("id_libro", "titulo", "autor", "id_usuario", "disponible", "fecha_subida")
    search_fields = ("titulo", "autor", "isbn", "id_usuario__nombre_usuario")
    list_filter = ("disponible", "estado", "tipo_tapa")
    date_hierarchy = "fecha_subida"
    ordering = ("-fecha_subida",)
    raw_id_fields = ("id_usuario", "id_genero")
    inlines = [ImagenLibroInline]

@admin.register(ImagenLibro)
class ImagenLibroAdmin(admin.ModelAdmin):
    list_display = ("id_imagen", "id_libro", "orden", "is_portada")
    search_fields = ("id_libro__titulo",)
    raw_id_fields = ("id_libro",)


# --- NUEVA Y POTENTE CONFIGURACIÓN PARA SOLICITUDES ---

# Esto permite ver los libros ofrecidos DENTRO de la vista de la solicitud
class SolicitudOfertaInline(admin.TabularInline):
    model = SolicitudOferta
    extra = 1  # Campos para añadir nuevos libros
    raw_id_fields = ('id_libro_ofrecido',)

@admin.register(SolicitudIntercambio)
class SolicitudIntercambioAdmin(admin.ModelAdmin):
    list_display = (
        'id_solicitud',
        'estado',
        'solicitante_user', # Método personalizado
        'receptor_user',    # Método personalizado
        'id_libro_deseado',
        'creada_en'
    )
    list_filter = ('estado', 'creada_en')
    search_fields = (
        'id_usuario_solicitante__nombre_usuario',
        'id_usuario_receptor__nombre_usuario',
        'id_libro_deseado__titulo'
    )
    raw_id_fields = (
        'id_usuario_solicitante',
        'id_usuario_receptor',
        'id_libro_deseado',
        'id_libro_ofrecido_aceptado'
    )
    inlines = [SolicitudOfertaInline] # Muestra las ofertas directamente aquí

    @admin.display(description='Solicitante')
    def solicitante_user(self, obj):
        return obj.id_usuario_solicitante.nombre_usuario

    @admin.display(description='Receptor')
    def receptor_user(self, obj):
        return obj.id_usuario_receptor.nombre_usuario


@admin.register(Calificacion)
class ClasificacionAdmin(admin.ModelAdmin):
    list_display = ("id_clasificacion", "id_usuario_calificador", "id_usuario_calificado", "puntuacion")
    raw_id_fields = ("id_usuario_calificador", "id_usuario_calificado")

# ---------------------------------------------------------------
# BORRAMOS o COMENTAMOS las configuraciones de los modelos viejos
# que ya no usamos o que no son relevantes ahora
# ---------------------------------------------------------------
# @admin.register(Intercambio) -> La eliminamos porque el modelo cambió
# @admin.register(Mensaje) -> La eliminamos porque el chat ahora depende de 'Conversacion'
# @admin.register(Conversacion) -> etc...
# ... puedes añadirlas de nuevo si las necesitas, pero sin errores

@admin.register(Intercambio)
class IntercambioAdmin(admin.ModelAdmin):
    list_display = ('id_intercambio','id_solicitud','id_libro_ofrecido_aceptado','estado_intercambio','lugar_intercambio','fecha_intercambio_pactada','fecha_completado')
    list_filter = ('estado_intercambio',)
    search_fields = ('id_solicitud__id_usuario_solicitante__nombre_usuario','id_solicitud__id_usuario_receptor__nombre_usuario','id_libro_ofrecido_aceptado__titulo')
    raw_id_fields = ('id_solicitud','id_libro_ofrecido_aceptado')

@admin.register(IntercambioCodigo)
class IntercambioCodigoAdmin(admin.ModelAdmin):
    list_display = ('id_intercambio','codigo','expira_en','usado_en')
    search_fields = ('codigo',)
    raw_id_fields = ('id_intercambio',)