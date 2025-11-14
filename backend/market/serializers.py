from django.conf import settings
from django.db.models import Q
from rest_framework import serializers
from django.conf import settings

from .models import (
    Libro, ImagenLibro, Genero, SolicitudIntercambio, SolicitudOferta,
    PuntoEncuentro, PropuestaEncuentro, Intercambio
)
from core.serializers import UsuarioLiteSerializer
from .constants import SOLICITUD_ESTADO, INTERCAMBIO_ESTADO


class GeneroSerializer(serializers.ModelSerializer):
    class Meta:
        model = Genero
        fields = ("id_genero", "nombre")



class LibroSerializer(serializers.ModelSerializer):
    # Alias del PK para el front
    id = serializers.IntegerField(source='id_libro', read_only=True)
    status_reason = serializers.CharField(read_only=True)

    owner_id = serializers.SerializerMethodField()
    owner_nombre = serializers.SerializerMethodField()
    id_genero = serializers.IntegerField(source='id_genero_id', read_only=True)
    genero_nombre = serializers.SerializerMethodField()

    en_negociacion = serializers.SerializerMethodField()
    public_disponible = serializers.SerializerMethodField()
    editable = serializers.SerializerMethodField()

    first_image = serializers.SerializerMethodField()

    class Meta:
        model = Libro
        fields = [
            'id', 'id_libro',
            'titulo', 'autor', 'isbn', 'anio_publicacion', 'estado',
            'editorial', 'tipo_tapa', 'descripcion',
            'disponible', 'fecha_subida',
            'status_reason',
            'owner_nombre', 'owner_id',
            'id_genero', 'genero_nombre',
            'en_negociacion', 'public_disponible', 'editable',
            'first_image',  
        ]

    # --- NUEVO ---
    def get_first_image(self, obj):
        """
        Usa anotación obj.first_image si viene; si no, calcula:
        1) portada; 2) primera por orden; 3) fallback 'books/librodefecto.png'.
        Siempre retorna URL absoluta con media_abs().
        """
        request = self.context.get('request')

        # 0) si viene anotado desde el queryset
        rel = getattr(obj, 'first_image', None)
        if rel:
            return media_abs(request, str(rel).replace('\\', '/'))

        # 1) portada explícita
        rel = (ImagenLibro.objects
               .filter(id_libro=obj, is_portada=True)
               .order_by('id_imagen')
               .values_list('url_imagen', flat=True)
               .first())

        # 2) primera por orden
        if not rel:
            rel = (ImagenLibro.objects
                   .filter(id_libro=obj)
                   .order_by('orden', 'id_imagen')
                   .values_list('url_imagen', flat=True)
                   .first())

        return media_abs(request, (rel or '').replace('\\', '/'))

    # ... (lo demás tal cual)
    def get_en_negociacion(self, obj):
        v = getattr(obj, 'en_negociacion', None)
        if v is not None:
            return bool(v)
        return Intercambio.objects.filter(
            Q(id_libro_ofrecido_aceptado_id=obj.id_libro) |
            Q(id_solicitud__id_libro_deseado_id=obj.id_libro),
            estado_intercambio__in=['Pendiente', 'Aceptado'],
        ).exists()

    def get_public_disponible(self, obj):
        v = getattr(obj, 'public_disponible', None)
        if v is not None:
            return bool(v)
        return bool(obj.disponible) and not self.get_en_negociacion(obj)

    def get_editable(self, obj):
        sr = (getattr(obj, 'status_reason', None) or '').upper()
        locked = sr in ('BAJA', 'COMPLETADO')
        return bool(obj.disponible) and not locked

    def get_owner_id(self, obj):
        return getattr(obj, 'id_usuario_id', None)

    def get_owner_nombre(self, obj):
        try:
            u_id = getattr(obj, 'id_usuario_id', None)
            if not u_id:
                return None
            u = getattr(obj, 'id_usuario', None)
            if u is not None:
                try:
                    return getattr(u, 'nombre_usuario', None)
                except Exception:
                    return None
            from core.models import Usuario
            u = Usuario.objects.filter(pk=u_id).only('nombre_usuario').first()
            return getattr(u, 'nombre_usuario', None) if u else None
        except Exception:
            return None

    def get_genero_nombre(self, obj):
        g = getattr(obj, 'id_genero', None)
        return getattr(g, 'nombre', None) if g else None


class LibroCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Libro
        fields = [
            'titulo', 'isbn', 'anio_publicacion', 'autor', 'estado',
            'descripcion', 'editorial', 'tipo_tapa', 'id_usuario', 'id_genero', 'disponible'
        ]


class ImagenLibroSerializer(serializers.ModelSerializer):
    url_abs = serializers.SerializerMethodField()  # 👈 AÑADIR

    class Meta:
        model = ImagenLibro
        fields = [
            'id_imagen', 'url_imagen', 'url_abs',  # 👈 AÑADIR url_abs aquí
            'descripcion', 'id_libro', 'orden', 'is_portada', 'created_at'
        ]

    def get_url_abs(self, obj):
        request = self.context.get('request')
        rel = ''
        try:
            rel = obj.url_imagen.url  # por si fuera ImageField
        except Exception:
            rel = str(getattr(obj, 'url_imagen', '') or '').replace('\\', '/')

        if rel and not (rel.startswith('http://') or rel.startswith('https://')):
            if rel.startswith('/media/'):
                pass
            elif rel.startswith('media/'):
                rel = '/' + rel
            else:
                from django.conf import settings
                rel = f"{settings.MEDIA_URL.rstrip('/')}/{rel}".replace('//', '/')

        if request and rel and rel.startswith('/'):
            return request.build_absolute_uri(rel)
        return rel or None


# En tu serializers.py

class LibroSimpleSerializer(serializers.ModelSerializer):
    """Serializer simple para mostrar info básica de un libro."""
    first_image = serializers.SerializerMethodField() # <-- AÑADIDO

    class Meta:
        model = Libro
        fields = ['id_libro', 'titulo', 'autor', 'first_image'] # <-- AÑADIDO 'first_image'

    def get_first_image(self, obj):
        # obj es la instancia de Libro
        # obj.imagenes.all() usará los datos de prefetch que cargamos en la vista
        try:
            # Intenta obtener la primera imagen (ya viene ordenada por el prefetch)
            primera_imagen = obj.imagenes.all()[0]
            rel = str(primera_imagen.url_imagen).replace('\\', '/')
        except (AttributeError, IndexError):
            # Si no hay imagen en el prefetch o la lista está vacía
            rel = None # Usará el default

        request = self.context.get('request')
        # Llama a la función helper 'media_abs' que está al final de tu serializers.py
        return media_abs(request, rel)


class SolicitudOfertaSerializer(serializers.ModelSerializer):
    libro_ofrecido = LibroSimpleSerializer(source='id_libro_ofrecido', read_only=True)

    class Meta:
        model = SolicitudOferta
        fields = ['id_oferta', 'libro_ofrecido']


# En tu serializers.py

class SolicitudIntercambioSerializer(serializers.ModelSerializer):
    solicitante = UsuarioLiteSerializer(source='id_usuario_solicitante', read_only=True)
    receptor = UsuarioLiteSerializer(source='id_usuario_receptor', read_only=True)
    libro_deseado = LibroSimpleSerializer(source='id_libro_deseado', read_only=True)
    ofertas = SolicitudOfertaSerializer(many=True, read_only=True)
    libro_aceptado = LibroSimpleSerializer(source='id_libro_ofrecido_aceptado', read_only=True)

    # calculados
    estado = serializers.SerializerMethodField()
    estado_slug = serializers.SerializerMethodField()
    fecha_completado = serializers.SerializerMethodField()

    chat_enabled = serializers.SerializerMethodField()
    intercambio_id = serializers.SerializerMethodField()
    conversacion_id = serializers.SerializerMethodField()
    lugar_intercambio = serializers.SerializerMethodField()
    fecha_intercambio_pactada = serializers.SerializerMethodField()

    class Meta:
        model = SolicitudIntercambio
        fields = [
            'id_solicitud', 'estado', 'estado_slug', 'creada_en', 'actualizada_en',
            'solicitante', 'receptor', 'libro_deseado', 'ofertas',
            'libro_aceptado',
            'chat_enabled', 'intercambio_id', 'conversacion_id',
            'lugar_intercambio', 'fecha_intercambio_pactada', 'fecha_completado'
        ]
        read_only_fields = fields

    # --- INICIO DE OPTIMIZACIÓN (Helpers para usar data precargada) ---

    def _get_prefetched_inter(self, obj):
        # Helper para obtener el intercambio precargado
        try:
            # .all() aquí usa la lista precargada, no hace una nueva consulta
            return obj.intercambio.all()[0]
        except (AttributeError, IndexError):
            return None

    def _get_prefetched_propuesta(self, inter):
        # Helper para obtener la propuesta aceptada precargada
        if not inter:
            return None
        try:
            # Usamos el 'to_attr' que definimos en la vista
            return inter.propuesta_aceptada[0]
        except (AttributeError, IndexError):
            return None

    def _get_prefetched_conv(self, inter):
        # Helper para obtener la conversación precargada
        if not inter:
            return None
        try:
            # .all() usa la lista precargada
            return inter.conversaciones.all()[0]
        except (AttributeError, IndexError):
            return None

    # --- FIN DE OPTIMIZACIÓN ---

    def _estado_efectivo(self, obj):
        inter = self._get_prefetched_inter(obj) # <--- MODIFICADO
        if inter and inter.estado_intercambio:
            st = (inter.estado_intercambio or '').lower()
            if st == 'completado':
                return 'Completado'
            if st == 'cancelado':
                return 'Cancelada'
            if st == 'rechazado':
                return 'Rechazada'
            if st == 'aceptado':
                return 'Aceptada'
            return 'Pendiente'
        return obj.estado or 'Pendiente'

    def get_estado(self, obj):
        return self._estado_efectivo(obj)

    def get_estado_slug(self, obj):
        return (self._estado_efectivo(obj) or '').lower()

    def get_chat_enabled(self, obj):
        return self.get_estado_slug(obj) in ('aceptada', 'completado')

    def get_intercambio_id(self, obj):
        inter = self._get_prefetched_inter(obj) # <--- MODIFICADO
        return getattr(inter, 'id_intercambio', None)

    def get_conversacion_id(self, obj):
        inter = self._get_prefetched_inter(obj) # <--- MODIFICADO
        conv = self._get_prefetched_conv(inter) # <--- MODIFICADO
        return getattr(conv, 'id_conversacion', None)

    def get_lugar_intercambio(self, obj):
        inter = self._get_prefetched_inter(obj) # <--- MODIFICADO
        p = self._get_prefetched_propuesta(inter) # <--- MODIFICADO
        if p:
            return p.direccion or getattr(getattr(p, 'id_punto', None), 'nombre', None)
        return getattr(inter, 'lugar_intercambio', None) # Fallback

    def get_fecha_intercambio_pactada(self, obj):
        inter = self._get_prefetched_inter(obj) # <--- MODIFICADO
        p = self._get_prefetched_propuesta(inter) # <--- MODIFICADO
        if p:
            return p.fecha_hora
        return getattr(inter, 'fecha_intercambio_pactada', None) # Fallback

    def get_fecha_completado(self, obj):
        inter = self._get_prefetched_inter(obj) # <--- MODIFICADO
        return getattr(inter, 'fecha_completado', None)


class ProponerEncuentroSerializer(serializers.Serializer):
    lugar = serializers.CharField(max_length=255)
    fecha = serializers.DateTimeField()  # pactada (datetime)


class ConfirmarEncuentroSerializer(serializers.Serializer):
    confirmar = serializers.BooleanField()


class GenerarCodigoSerializer(serializers.Serializer):
    codigo = serializers.CharField(max_length=12, required=False, allow_blank=True)


class CompletarConCodigoSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    codigo = serializers.CharField(max_length=12, allow_blank=False, trim_whitespace=True)
    fecha = serializers.DateField(required=False, allow_null=True)


class PuntoEncuentroSerializer(serializers.ModelSerializer):
    class Meta:
        model = PuntoEncuentro
        fields = "__all__"


class PropuestaEncuentroSerializer(serializers.ModelSerializer):
    class Meta:
        model = PropuestaEncuentro
        fields = "__all__"

def media_abs(request, rel: str | None = None) -> str:
    rel = (rel or "books/librodefecto.png").strip()
    if rel.startswith(("http://", "https://")):
        return rel
    # normaliza
    rel = rel.lstrip("/").replace("\\", "/")
    if rel.startswith("media/"):
        rel = rel[len("media/"):]
    mu = str(getattr(settings, "MEDIA_URL", "/media/")).strip()

    # MEDIA_URL absoluto
    if mu.startswith(("http://", "https://")):
        return f"{mu.rstrip('/')}/{rel}"

    # MEDIA_URL relativo → vuelve absoluto con el request
    media_prefix = mu.strip("/") or "media"
    url_path = f"/{media_prefix}/{rel}".replace("//", "/")
    try:
        if request and hasattr(request, "build_absolute_uri"):
            return request.build_absolute_uri(url_path)
    except Exception:
        pass
    return url_path

