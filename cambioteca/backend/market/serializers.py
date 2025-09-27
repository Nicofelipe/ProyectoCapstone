from rest_framework import serializers
from .models import Libro, ImagenLibro

class LibroSerializer(serializers.ModelSerializer):
    # Alias del PK para el front
    id = serializers.IntegerField(source='id_libro', read_only=True)
    # Dueño a prueba de FK nulo/inválido
    owner_id = serializers.SerializerMethodField()
    owner_nombre = serializers.SerializerMethodField()

    class Meta:
        model = Libro
        fields = [
            'id', 'id_libro',
            'titulo', 'autor', 'isbn', 'anio_publicacion', 'estado',
            'editorial', 'genero', 'tipo_tapa', 'descripcion',  # 👈 añadí descripcion
            'disponible', 'fecha_subida',
            'owner_nombre', 'owner_id',
        ]

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


# 👇 la dejamos igual; no rompe mientras no la instancies desde una vista.
class LibroCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Libro
        fields = [
            'titulo','isbn','anio_publicacion','autor','estado',
            'descripcion','editorial','genero','tipo_tapa','id_usuario'
        ]


class ImagenLibroSerializer(serializers.ModelSerializer):
    class Meta:
        model = ImagenLibro
        fields = [
            'id_imagen','url_imagen','descripcion','id_libro','orden','is_portada','created_at'
        ]
