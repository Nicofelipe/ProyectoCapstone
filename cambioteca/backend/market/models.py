#market models.py

from django.db import models

# Referencias entre apps por string:
# 'core.Usuario', 'market.Libro'

class Libro(models.Model):
    id_libro = models.AutoField(primary_key=True)
    titulo = models.CharField(max_length=255)
    isbn = models.CharField(max_length=13)
    anio_publicacion = models.PositiveSmallIntegerField()
    autor = models.CharField(max_length=255)
    estado = models.CharField(max_length=20)
    descripcion = models.TextField()
    editorial = models.CharField(max_length=255)
    genero = models.CharField(max_length=100)
    tipo_tapa = models.CharField(max_length=20)
    disponible = models.BooleanField(default=True)   # mapea a TINYINT(1)
    fecha_subida = models.DateTimeField(auto_now_add=True, db_column='fecha_subida')

    # Acceso desde Usuario: usuario.libros.all()
    id_usuario = models.ForeignKey(
        'core.Usuario',
        db_column='id_usuario',
        on_delete=models.DO_NOTHING,
        related_name='libros'
    )

    class Meta:
        db_table = 'libro'
        managed = False

    def __str__(self):
        return f"{self.titulo} — {self.autor}"


class Clasificacion(models.Model):
    id_clasificacion = models.AutoField(primary_key=True)
    puntuacion = models.IntegerField()
    comentario = models.TextField()

    # Accesos:
    # - usuario.clasificaciones_hechas.all()
    # - usuario.clasificaciones_recibidas.all()
    id_usuario_calificador = models.ForeignKey(
        'core.Usuario',
        db_column='id_usuario_calificador',
        on_delete=models.DO_NOTHING,
        related_name='clasificaciones_hechas'
    )
    id_usuario_calificado = models.ForeignKey(
        'core.Usuario',
        db_column='id_usuario_calificado',
        on_delete=models.DO_NOTHING,
        related_name='clasificaciones_recibidas'
    )

    id_intercambio = models.ForeignKey(
        'market.Intercambio', db_column='id_intercambio',
        on_delete=models.SET_NULL, null=True, blank=True,
        related_name='calificaciones'
    )

    class Meta:
        db_table = 'clasificacion'
        managed = False

    def __str__(self):
        return f"Clasificación {self.puntuacion} a {self.id_usuario_calificado_id}"


class Favorito(models.Model):
    id_favorito = models.AutoField(primary_key=True)

    # Accesos:
    # - usuario.favoritos.all()
    # - libro.marcado_como_favorito_por.all()
    id_usuario = models.ForeignKey(
        'core.Usuario',
        db_column='id_usuario',
        on_delete=models.DO_NOTHING,
        related_name='favoritos'
    )
    id_libro = models.ForeignKey(
        'market.Libro',
        db_column='id_libro',
        on_delete=models.DO_NOTHING,
        related_name='marcado_como_favorito_por'
    )

    class Meta:
        db_table = 'favorito'
        managed = False

    def __str__(self):
        return f"Fav #{self.id_favorito} — Usuario {self.id_usuario_id} / Libro {self.id_libro_id}"


class ImagenLibro(models.Model):
    id_imagen = models.AutoField(primary_key=True)
    # Dejá CharField si no querés depender de Pillow.
    url_imagen = models.CharField(max_length=255, null=True, blank=True)
    descripcion = models.CharField(max_length=255, null=True, blank=True)

    # Acceso: libro.imagenes.all()
    id_libro = models.ForeignKey(
        'market.Libro',
        db_column='id_libro',
        on_delete=models.DO_NOTHING,
        related_name='imagenes'
    )

    # IMPORTANTE: refleja que la columna en BD no acepta NULL
    orden = models.PositiveIntegerField(default=0, db_column='orden')
    is_portada = models.BooleanField(default=False, db_column='is_portada')
    created_at = models.DateTimeField(auto_now_add=True, db_column='created_at')

    class Meta:
        db_table = 'imagen_libro'
        managed = False

    def __str__(self):
        return f"Imagen #{self.id_imagen} de Libro {self.id_libro_id}"

class Intercambio(models.Model):
    ESTADO_CHOICES = [
        ('Pendiente', 'Pendiente'),
        ('Aceptado', 'Aceptado'),
        ('Rechazado', 'Rechazado'),
        ('Completado', 'Completado'),
    ]

    id_intercambio = models.AutoField(primary_key=True)
    lugar_intercambio = models.CharField(max_length=255)
    fecha_intercambio = models.DateField(null=True, blank=True)
    estado_intercambio = models.CharField(max_length=10, choices=ESTADO_CHOICES, default='Pendiente')
    fecha_completado = models.DateField(null=True, blank=True)

    # Accesos:
    # - usuario.intercambios_solicitados.all()
    # - usuario.intercambios_ofrecidos.all()
    # - libro.intercambios_donde_fue_solicitado.all()
    # - libro.intercambios_donde_fue_ofrecido.all()
    id_usuario_solicitante = models.ForeignKey(
        'core.Usuario',
        db_column='id_usuario_solicitante',
        on_delete=models.DO_NOTHING,
        related_name='intercambios_solicitados'
    )
    id_usuario_ofreciente = models.ForeignKey(
        'core.Usuario',
        db_column='id_usuario_ofreciente',
        on_delete=models.DO_NOTHING,
        related_name='intercambios_ofrecidos'
    )
    id_libro_solicitado = models.ForeignKey(
        'market.Libro',
        db_column='id_libro_solicitado',
        on_delete=models.DO_NOTHING,
        related_name='intercambios_donde_fue_solicitado'
    )
    id_libro_ofrecido = models.ForeignKey(
        'market.Libro',
        db_column='id_libro_ofrecido',
        on_delete=models.DO_NOTHING,
        related_name='intercambios_donde_fue_ofrecido'
    )

    class Meta:
        db_table = 'intercambio'
        managed = False

    def __str__(self):
        return f"Intercambio #{self.id_intercambio} — {self.estado_intercambio}"



class Mensaje(models.Model):
    id_mensaje = models.AutoField(primary_key=True)
    mensaje = models.TextField()
    fecha_envio = models.DateTimeField()

    # Accesos:
    # - intercambio.mensajes.all()
    # - usuario.mensajes_enviados.all()
    # - usuario.mensajes_recibidos.all()
    id_intercambio = models.ForeignKey(
        'market.Intercambio',
        db_column='id_intercambio',
        on_delete=models.DO_NOTHING,
        related_name='mensajes'
    )
    id_usuario_emisor = models.ForeignKey(
        'core.Usuario',
        db_column='id_usuario_emisor',
        on_delete=models.DO_NOTHING,
        related_name='mensajes_enviados'
    )
    id_usuario_receptor = models.ForeignKey(
        'core.Usuario',
        db_column='id_usuario_receptor',
        on_delete=models.DO_NOTHING,
        related_name='mensajes_recibidos'
    )

    class Meta:
        db_table = 'mensaje'
        managed = False

    def __str__(self):
        return f"Msg #{self.id_mensaje} — Intercambio {self.id_intercambio_id}"


class LibroSolicitudesVistas(models.Model):
    id = models.AutoField(primary_key=True)
    id_usuario = models.ForeignKey(
        'core.Usuario', db_column='id_usuario',
        on_delete=models.CASCADE, related_name='libros_solicitudes_vistas'
    )
    id_libro = models.ForeignKey(
        'market.Libro', db_column='id_libro',
        on_delete=models.CASCADE, related_name='solicitudes_vistas_por'
    )
    ultimo_visto_id_intercambio = models.IntegerField(default=0)
    visto_por_ultima_vez = models.DateTimeField()

    class Meta:
        db_table = 'libro_solicitudes_vistas'
        managed = False
        unique_together = (('id_usuario', 'id_libro'),)