
from .models import Libro, ImagenLibro, Genero, SolicitudIntercambio, SolicitudOferta,  PuntoEncuentro, PropuestaEncuentro, Intercambio
from core.serializers import UsuarioLiteSerializer
from rest_framework import serializers
from django.db.models import Q
from .constants import SOLICITUD_ESTADO, INTERCAMBIO_ESTADO


class GeneroSerializer(serializers.ModelSerializer):
    class Meta:
        model = Genero
        fields = ("id_genero", "nombre")


class LibroSerializer(serializers.ModelSerializer):
    # Alias del PK para el front
    id = serializers.IntegerField(source='id_libro', read_only=True)
    # Dueño a prueba de FK nulo/inválido
    owner_id = serializers.SerializerMethodField()
    owner_nombre = serializers.SerializerMethodField()
    # Mostrar PK del género y su nombre
    id_genero = serializers.IntegerField(source='id_genero_id', read_only=True)
    genero_nombre = serializers.SerializerMethodField()

     # 👇 NUEVO: campos calculados/annotated
    en_negociacion = serializers.SerializerMethodField()
    public_disponible = serializers.SerializerMethodField()

    class Meta:
        model = Libro
        fields = [
            'id', 'id_libro',
            'titulo', 'autor', 'isbn', 'anio_publicacion', 'estado',
            'editorial', 'tipo_tapa', 'descripcion',
            'disponible', 'fecha_subida',
            'owner_nombre', 'owner_id',
            'id_genero', 'genero_nombre',
            'en_negociacion', 'public_disponible',   # 👈 NUEVO
        ]
    def get_en_negociacion(self, obj):
        """
        Usa la anotación si viene del queryset; si no, calcula on-demand (detalle).
        """
        v = getattr(obj, 'en_negociacion', None)
        if v is not None:
            return bool(v)
        # Fallback seguro para retrieve directo
        return Intercambio.objects.filter(
            Q(id_libro_ofrecido_aceptado_id=obj.id_libro) |
            Q(id_solicitud__id_libro_deseado_id=obj.id_libro),
            estado_intercambio__in=['Pendiente', 'Aceptado'],
        ).exists()

    def get_public_disponible(self, obj):
        v = getattr(obj, 'public_disponible', None)
        if v is not None:
            return bool(v)
        # Si no viene anotado: disponible y no en negociación
        return bool(obj.disponible) and not self.get_en_negociacion(obj)
    

    def get_owner_id(self, obj):
        return getattr(obj, 'id_usuario_id', None)

    def get_owner_nombre(self, obj):
        try:
            u_id = getattr(obj, 'id_usuario_id', None)
            if not u_id:
                return None
            # Si ya viene en caché por select_related, úsalo
            u = getattr(obj, 'id_usuario', None)
            if u is not None:
                try:
                    return getattr(u, 'nombre_usuario', None)
                except Exception:
                    return None
            # Fallback por si no está en caché
            from core.models import Usuario
            u = Usuario.objects.filter(pk=u_id).only('nombre_usuario').first()
            return getattr(u, 'nombre_usuario', None) if u else None
        except Exception:
            return None
        
    def get_genero_nombre(self, obj):
        g = getattr(obj, 'id_genero', None)
        return getattr(g, 'nombre', None) if g else None
    
    


# 👇 la dejamos igual; no rompe mientras no la instancies desde una vista.
class LibroCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Libro
        fields = [
            'titulo','isbn','anio_publicacion','autor','estado',
            'descripcion','editorial','tipo_tapa','id_usuario','id_genero','disponible'
        ]


class ImagenLibroSerializer(serializers.ModelSerializer):
    class Meta:
        model = ImagenLibro
        fields = [
            'id_imagen','url_imagen','descripcion','id_libro','orden','is_portada','created_at'
        ]
    def get_url_abs(self, obj):
        request = self.context.get('request')

        # 1) intenta usar .url si fuera ImageField
        rel = ''
        try:
            rel = obj.url_imagen.url
        except Exception:
            rel = str(getattr(obj, 'url_imagen', '') or '').replace('\\', '/')

        # 2) normaliza prefijos
        if rel and not (rel.startswith('http://') or rel.startswith('https://')):
            if rel.startswith('/media/'):
                pass  # ok
            elif rel.startswith('media/'):
                rel = '/' + rel
            else:
                rel = f"{settings.MEDIA_URL.rstrip('/')}/{rel}".replace('//', '/')

        # 3) si tenemos request, vuelve absoluto
        if request and rel and rel.startswith('/'):
            return request.build_absolute_uri(rel)
        return rel or None




class LibroSimpleSerializer(serializers.ModelSerializer):
    """Serializer simple para mostrar info básica de un libro."""
    class Meta:
        model = Libro
        fields = ['id_libro', 'titulo', 'autor']

class SolicitudOfertaSerializer(serializers.ModelSerializer):
    libro_ofrecido = LibroSimpleSerializer(source='id_libro_ofrecido', read_only=True)

    class Meta:
        model = SolicitudOferta
        fields = ['id_oferta', 'libro_ofrecido']

class SolicitudIntercambioSerializer(serializers.ModelSerializer):
    solicitante = UsuarioLiteSerializer(source='id_usuario_solicitante', read_only=True)
    receptor = UsuarioLiteSerializer(source='id_usuario_receptor', read_only=True)
    libro_deseado = LibroSimpleSerializer(source='id_libro_deseado', read_only=True)
    ofertas = SolicitudOfertaSerializer(many=True, read_only=True)
    libro_aceptado = LibroSimpleSerializer(source='id_libro_ofrecido_aceptado', read_only=True)

    # 👇 CAMBIO: estos 3 se calculan
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

    def _ultimo_inter(self, obj):
        try:
            return obj.intercambio.all().order_by('-id_intercambio').first()
        except Exception:
            return None

    # 👇 ESTADO EFECTIVO combinando Solicitud + Intercambio
    def _estado_efectivo(self, obj):
        inter = self._ultimo_inter(obj)
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
            # si llegara 'pendiente'
            return 'Pendiente'
        # fallback: el propio estado de la solicitud
        return obj.estado or 'Pendiente'

    def get_estado(self, obj):
        return self._estado_efectivo(obj)

    def get_estado_slug(self, obj):
        return (self._estado_efectivo(obj) or '').lower()

    def get_chat_enabled(self, obj):
        # chat cuando ya está aceptada (o más)
        return self.get_estado_slug(obj) in ('aceptada', 'completado')

    def get_intercambio_id(self, obj):
        inter = self._ultimo_inter(obj)
        return getattr(inter, 'id_intercambio', None)

    def get_conversacion_id(self, obj):
        inter = self._ultimo_inter(obj)
        if not inter:
            return None
        try:
            conv = inter.conversaciones.all().order_by('id_conversacion').first()
            return getattr(conv, 'id_conversacion', None)
        except Exception:
            return None

    def get_lugar_intercambio(self, obj):
        inter = self._ultimo_inter(obj)
        if not inter:
            return None
        # Preferir propuesta aceptada
        p = PropuestaEncuentro.objects.filter(
            id_intercambio=inter, estado="ACEPTADA"
        ).order_by('-id').first()
        if p:
            return p.direccion or getattr(getattr(p, 'id_punto', None), 'nombre', None)
        # fallback al campo del Intercambio
        return getattr(inter, 'lugar_intercambio', None)

    def get_fecha_intercambio_pactada(self, obj):
        inter = self._ultimo_inter(obj)
        if not inter:
            return None
        p = PropuestaEncuentro.objects.filter(
            id_intercambio=inter, estado="ACEPTADA"
        ).order_by('-id').first()
        if p:
            return p.fecha_hora
        return getattr(inter, 'fecha_intercambio_pactada', None)

    def get_fecha_completado(self, obj):
        inter = self._ultimo_inter(obj)
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