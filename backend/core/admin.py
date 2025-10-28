from django.contrib import admin
from .models import Region, Comuna, Usuario, Notificacion, SeguimientoActividad, Sesion, VerificacionUsuario

@admin.register(Region)
class RegionAdmin(admin.ModelAdmin):
    list_display = ('id_region', 'nombre')
    search_fields = ('nombre',)

@admin.register(Comuna)
class ComunaAdmin(admin.ModelAdmin):
    list_display = ('id_comuna', 'nombre', 'id_region')
    list_filter = ('id_region',)
    search_fields = ('nombre',)

@admin.register(Usuario)
class UsuarioAdmin(admin.ModelAdmin):
    list_display = ('id_usuario', 'nombre_usuario', 'email', 'comuna', 'activo', 'verificado', 'calificacion', 'numero_intercambios')
    list_filter = ('activo', 'verificado', 'comuna__id_region')
    search_fields = ('nombre_usuario', 'nombres', 'apellido_paterno', 'email', 'rut')

@admin.register(Notificacion)
class NotificacionAdmin(admin.ModelAdmin):
    list_display = ('id_notificacion', 'id_usuario', 'leido', 'fecha_envio')
    list_filter = ('leido',)
    search_fields = ('mensaje',)

@admin.register(SeguimientoActividad)
class SeguimientoActividadAdmin(admin.ModelAdmin):
    list_display = ('id_actividad', 'id_usuario', 'accion', 'fecha_hora', 'ip_origen', 'dispositivo')
    list_filter = ('dispositivo', 'fecha_hora')
    search_fields = ('accion', 'ip_origen')

@admin.register(Sesion)
class SesionAdmin(admin.ModelAdmin):
    list_display = ('id_sesion', 'id_usuario', 'dispositivo', 'fecha_inicio', 'fecha_expiracion')
    list_filter = ('dispositivo',)
    search_fields = ('token',)

@admin.register(VerificacionUsuario)
class VerificacionUsuarioAdmin(admin.ModelAdmin):
    list_display = ('id_verificacion', 'id_usuario', 'documento_identidad', 'fecha_verificacion', 'verificado_por')
    search_fields = ('documento_identidad', 'verificado_por')
