import os, uuid
from collections import defaultdict
from datetime import date
from django.db.models import Prefetch
from django.conf import settings
from django.core.files.storage import default_storage
from django.utils import timezone
from django.utils.crypto import get_random_string
from django.utils.dateparse import parse_datetime
from django.db import connection, transaction, IntegrityError
from django.db.models import (
    Q, F, Value, Count, IntegerField, Exists, Subquery, OuterRef, Max, Avg,
    BooleanField, Case, When
)
from django.db.models.functions import Coalesce, Greatest
from rest_framework import permissions, viewsets, status, serializers as drf_serializers
from rest_framework.decorators import action, api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import (
    Libro, Genero, Favorito, ImagenLibro, LibroSolicitudesVistas,
    SolicitudIntercambio, SolicitudOferta, Intercambio,
    Conversacion, ConversacionParticipante, ConversacionMensaje,
    PuntoEncuentro, PropuestaEncuentro, IntercambioCodigo
)
from .serializers import (
    LibroSerializer, GeneroSerializer, SolicitudIntercambioSerializer,
    ProponerEncuentroSerializer, ConfirmarEncuentroSerializer,
    GenerarCodigoSerializer, CompletarConCodigoSerializer, PuntoEncuentroSerializer
)
from .constants import SOLICITUD_ESTADO, INTERCAMBIO_ESTADO, MEETING_METHOD, PROPOSAL_STATE, PUNTO_TIPO

def _inter_prefetch():
    return Prefetch(
        'intercambio',
        queryset=Intercambio.objects
            .select_related('id_libro_ofrecido_aceptado')
            .order_by('-id_intercambio')
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def catalog_generos(request):
    qs = Genero.objects.all().order_by("nombre")
    return Response(GeneroSerializer(qs, many=True).data)


# =========================
# Helpers
# =========================
def media_abs(request, rel: str | None = None) -> str:
    """
    Construye una URL ABSOLUTA a partir de una ruta relativa en MEDIA.
    Soporta MEDIA_URL relativo ('/media/') y absoluto ('https://host/media/').
    Soporta rel ya absoluto.
    """
    rel = (rel or "books/librodefecto.png").strip()

    # 0) Si ya es absoluta, devuélvela tal cual
    if rel.startswith("http://") or rel.startswith("https://"):
        return rel

    # 1) Normaliza la ruta relativa: sin leading slash y sin 'media/' duplicado
    rel = rel.lstrip("/").replace("\\", "/")
    if rel.startswith("media/"):
        rel = rel[len("media/"):]

    # 2) Lee MEDIA_URL
    mu = str(getattr(settings, "MEDIA_URL", "/media/")).strip()

    # 3) Si MEDIA_URL es absoluta, une directo
    if mu.startswith("http://") or mu.startswith("https://"):
        return f"{mu.rstrip('/')}/{rel}"

    # 4) Si MEDIA_URL es relativa, construye path y vuelve absoluto con request
    media_prefix = mu.strip("/") or "media"
    url_path = f"/{media_prefix}/{rel}".replace("//", "/")
    try:
        return request.build_absolute_uri(url_path)
    except Exception:
        # Fallback (muy raro en DRF): devuelve el path relativo
        return url_path

def _save_book_image(file_obj) -> str:
    try:
        file_obj.seek(0)
    except Exception:
        pass

    original = getattr(file_obj, "name", "book")
    ext = os.path.splitext(original)[1].lower() or ".jpg"
    rel_path = f"books/{uuid.uuid4().hex}{ext}"

    try:
        base_str = str(settings.MEDIA_ROOT)
        os.makedirs(os.path.join(base_str, "books"), exist_ok=True)
    except Exception:
        pass

    saved_rel = default_storage.save(rel_path, file_obj)
    return str(saved_rel).replace("\\", "/")

# =========================
# Libros (read-only)
# =========================

active_ix = Exists(
    Intercambio.objects.filter(
        Q(id_libro_ofrecido_aceptado=OuterRef('pk')) |
        Q(id_solicitud__id_libro_deseado=OuterRef('pk'))
    ).filter(estado_intercambio__in=['Pendiente','Aceptado'])
)


class LibroViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = LibroSerializer
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        qs = (Libro.objects
              .select_related('id_usuario')
              .annotate(en_negociacion=active_ix)  # 👈
              .annotate(
                  public_disponible=Case(
                      When(disponible=True, en_negociacion=False, then=Value(True)),
                      default=Value(False),
                      output_field=BooleanField(),
                  )
              )
              .all()
              .order_by('-id_libro'))

        q = self.request.query_params.get('query')
        if q:
            qs = qs.filter(
                Q(titulo__icontains=q) |
                Q(autor__icontains=q) |
                Q(id_genero__nombre__icontains=q)
            )
        return qs

    @action(detail=False, methods=['get'])
    def latest(self, request):
        qs = (
            Libro.objects
            .annotate(en_negociacion=active_ix)
            .filter(disponible=True, en_negociacion=False)  # 👈 no mostrar en negociación
            .order_by('-fecha_subida', '-id_libro')[:10]
        )
        data = LibroSerializer(qs, many=True).data
        return Response(data)

    @action(detail=False, methods=['get'])
    def populares(self, request):
        from .models import Intercambio, Libro

        # 1) Conteo de intercambios completados por TÍTULO (sumando ambos roles)
        qs_aceptado = (
            Intercambio.objects
            .filter(estado_intercambio='Completado')
            .values(title=F('id_libro_ofrecido_aceptado__titulo'))
            .annotate(n=Count('id_intercambio'))
        )
        qs_deseado = (
            Intercambio.objects
            .filter(estado_intercambio='Completado')
            .values(title=F('id_solicitud__id_libro_deseado__titulo'))
            .annotate(n=Count('id_intercambio'))
        )

        # 2) Acumular por clave case-insensitive (para no duplicar por mayúsculas)
        acc = {}          # key -> total_intercambios
        display_map = {}  # key -> título a mostrar (primero visto)
        def key_of(t):
            t = (t or '').strip()
            return t.casefold() if t else '(sin título)'

        for row in qs_aceptado:
            t = row['title'] or '(sin título)'
            k = key_of(t)
            acc[k] = acc.get(k, 0) + int(row['n'] or 0)
            display_map.setdefault(k, (t or '(sin título)').strip())

        for row in qs_deseado:
            t = row['title'] or '(sin título)'
            k = key_of(t)
            acc[k] = acc.get(k, 0) + int(row['n'] or 0)
            display_map.setdefault(k, (t or '(sin título)').strip())

        # 3) Top 10 por intercambios
        top_keys = sorted(acc.keys(), key=lambda k: (-acc[k], display_map[k]))[:10]

        # 4) Para cada título del top: cuántos anuncios activos (disponibles) hay ahora
        out = []
        for k in top_keys:
            title = display_map[k]
            repeticiones = Libro.objects.filter(titulo__iexact=title, disponible=True).count()
            out.append({
                "titulo": title,
                "total_intercambios": acc[k],
                "repeticiones": int(repeticiones),
            })

        return Response(out)

# =========================
# Crear libro
# =========================
@api_view(["POST"])
@permission_classes([AllowAny])
def create_book(request):
    data = request.data
    required = [
        "titulo", "isbn", "anio_publicacion", "autor", "estado",
        "descripcion", "editorial", "id_genero", "tipo_tapa", "id_usuario"
    ]
    missing = [k for k in required if not data.get(k)]
    if missing:
        return Response({"detail": f"Faltan: {', '.join(missing)}"}, status=400)

    # --- NUEVO: resolver fecha_subida ---
    raw = (data.get("fecha_subida") or "").strip()
    dt = parse_datetime(raw) if raw else None
    if dt and timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    if not dt:
        dt = timezone.now()

    try:
        libro = Libro.objects.create(
            titulo=data["titulo"],
            isbn=str(data["isbn"]),
            anio_publicacion=int(data["anio_publicacion"]),
            autor=data["autor"],
            estado=data["estado"],
            descripcion=data["descripcion"],
            editorial=data["editorial"],
            tipo_tapa=data["tipo_tapa"],
            id_usuario_id=int(data["id_usuario"]),
            id_genero_id=int(data["id_genero"]),
            disponible=bool(data.get("disponible", True)),
            fecha_subida=dt,            # 👈 imprescindible
        )
        return Response({"id": libro.id_libro}, status=201)
    except Exception as e:
        return Response({"detail": f"No se pudo crear: {e}"}, status=400)

# =========================
# Subida y gestión de imágenes
# =========================

def _book_locked_by_completed(libro_id: int) -> bool:
    return Intercambio.objects.filter(
        estado_intercambio="Completado"
    ).filter(
        Q(id_libro_ofrecido_aceptado_id=libro_id) |
        Q(id_solicitud__id_libro_deseado_id=libro_id)
    ).exists()


@api_view(["POST"])
@permission_classes([AllowAny])  # cámbialo a IsAuthenticated para producción
@parser_classes([MultiPartParser, FormParser])
def upload_image(request, libro_id: int):
    """
    Sube una imagen y la guarda en MEDIA/books/.
    FormData: image (file), [descripcion], [orden], [is_portada]
    """
    file_obj = request.FILES.get("image")
    if not file_obj:
        return Response({"detail": "Falta archivo 'image'."}, status=400)

    libro = Libro.objects.filter(pk=libro_id).first()
    if not libro:
        return Response({"detail": "Libro no encontrado."}, status=404)

    # 👇 Bloquea si el libro está “lockeado” por intercambio completado
    if _book_locked_by_completed(libro_id):
        return Response(
            {"detail": "No se pueden modificar imágenes: el libro tiene un intercambio Completado."},
            status=status.HTTP_409_CONFLICT
    )

    try:
        rel = _save_book_image(file_obj)

        next_ord = (ImagenLibro.objects
                    .filter(id_libro=libro)
                    .aggregate(m=Max('orden'))['m'])
        next_ord = (next_ord or 0) + 1

        kwargs = dict(
            url_imagen=rel,
            descripcion=request.data.get("descripcion") or "",
            id_libro=libro,
            orden=next_ord,
            is_portada=False,
            created_at=timezone.now()
        )

        if request.data.get("orden") is not None:
            try:
                kwargs["orden"] = int(request.data.get("orden"))
            except Exception:
                kwargs["orden"] = next_ord

        is_portada_raw = request.data.get("is_portada")
        if is_portada_raw is not None:
            try:
                kwargs["is_portada"] = bool(int(is_portada_raw))
            except Exception:
                kwargs["is_portada"] = False

        with transaction.atomic():
            if kwargs.get("is_portada"):
                ImagenLibro.objects.filter(id_libro=libro).update(is_portada=False)
            img = ImagenLibro.objects.create(**kwargs)

        return Response({
            "id_imagen": getattr(img, "id_imagen", None),
            "url_imagen": rel,
            "url_abs": media_abs(request, rel),
            "is_portada": getattr(img, "is_portada", False),
            "orden": getattr(img, "orden", None),
        }, status=201)
    except Exception as e:
        return Response({"detail": f"No se pudo guardar la imagen: {e}"}, status=400)

@api_view(["GET"])
@permission_classes([AllowAny])
def list_images(request, libro_id: int):
    libro = Libro.objects.filter(pk=libro_id).first()
    if not libro:
        return Response({"detail": "Libro no encontrado."}, status=404)

    qs = ImagenLibro.objects.filter(id_libro=libro).order_by("orden", "id_imagen")
    data = []
    for im in qs:
        rel = (im.url_imagen or "").replace("\\", "/")
        data.append({
            "id_imagen": im.id_imagen,
            "url_imagen": rel,
            "url_abs": media_abs(request, rel),
            "descripcion": im.descripcion,
            "orden": getattr(im, "orden", None),
            "is_portada": getattr(im, "is_portada", False),
            "created_at": getattr(im, "created_at", None),
        })
    return Response(data)

@api_view(["PATCH"])
@permission_classes([AllowAny])
def update_image(request, imagen_id: int):
    img = ImagenLibro.objects.filter(pk=imagen_id).select_related("id_libro").first()
    if not img:
        return Response({"detail": "Imagen no encontrada."}, status=404)
    
    # 👇 Bloquea si el libro está lockeado
    if _book_locked_by_completed(img.id_libro_id):
        return Response(
            {"detail": "No se pueden modificar imágenes: el libro tiene un intercambio Completado."},
            status=status.HTTP_409_CONFLICT
        )

    changed = False
    is_portada_raw = request.data.get("is_portada")
    if is_portada_raw is not None:
        new_val = bool(int(is_portada_raw))
        if new_val:
            ImagenLibro.objects.filter(id_libro=img.id_libro).exclude(pk=img.pk).update(is_portada=False)
        img.is_portada = new_val
        changed = True

    if request.data.get("orden") is not None:
        try:
            img.orden = int(request.data.get("orden"))
            changed = True
        except Exception:
            pass

    if request.data.get("descripcion") is not None:
        img.descripcion = request.data.get("descripcion") or ""
        changed = True

    if changed:
        img.save()

    rel = (img.url_imagen or "").replace("\\", "/")
    return Response({
        "id_imagen": img.id_imagen,
        "url_imagen": rel,
        "url_abs": media_abs(request, rel),
        "descripcion": img.descripcion,
        "orden": getattr(img, "orden", None),
        "is_portada": getattr(img, "is_portada", False),
    })

@api_view(["DELETE"])
@permission_classes([AllowAny])
def delete_image(request, imagen_id: int):
    img = ImagenLibro.objects.filter(pk=imagen_id).first()
    if not img:
        return Response({"detail": "Imagen no encontrada."}, status=404)
    
    # 👇 Bloquea si el libro está lockeado
    if _book_locked_by_completed(img.id_libro_id):
        return Response(
            {"detail": "No se pueden modificar imágenes: el libro tiene un intercambio Completado."},
            status=status.HTTP_409_CONFLICT
        )

    rel = (img.url_imagen or "").replace("\\", "/")
    try:
        img.delete()
    finally:
        try:
            if rel:
                default_storage.delete(rel)
        except Exception:
            pass
    return Response(status=204)

# =========================
# Mis libros / historial
# =========================


@api_view(["GET"])
@permission_classes([AllowAny])
def my_books(request):
    user_id = request.query_params.get("user_id")
    if not user_id:
        return Response({"detail": "Falta user_id"}, status=400)

    # Portada o primera imagen
    portada_sq = (ImagenLibro.objects
                  .filter(id_libro=OuterRef("pk"), is_portada=True)
                  .order_by("id_imagen").values_list("url_imagen", flat=True)[:1])

    first_by_order_sq = (ImagenLibro.objects
                         .filter(id_libro=OuterRef("pk"))
                         .order_by("orden", "id_imagen").values_list("url_imagen", flat=True)[:1])

    # Existence flags
    has_si = Exists(SolicitudIntercambio.objects.filter(id_libro_deseado=OuterRef("pk")))
    has_ix_any = Exists(
        Intercambio.objects.filter(
            Q(id_libro_ofrecido_aceptado=OuterRef("pk")) |      # rol: ofrecido_aceptado
            Q(id_solicitud__id_libro_deseado=OuterRef("pk"))    # rol: deseado
        )
    )

    # Máximos de actividad (IDs) en ambos roles
    max_ix_acc_sq = (Intercambio.objects
                     .filter(id_libro_ofrecido_aceptado=OuterRef("pk"))
                     .values("id_libro_ofrecido_aceptado")
                     .annotate(m=Max("id_intercambio")).values("m")[:1])

    max_ix_des_sq = (Intercambio.objects
                     .filter(id_solicitud__id_libro_deseado=OuterRef("pk"))
                     .values("id_solicitud__id_libro_deseado")
                     .annotate(m=Max("id_intercambio")).values("m")[:1])

    max_si_sq = (SolicitudIntercambio.objects
                 .filter(id_libro_deseado=OuterRef("pk"))
                 .values("id_libro_deseado")
                 .annotate(m=Max("id_solicitud")).values("m")[:1])

    # "Último visto" (un solo entero — seguimos usando el mismo campo)
    seen_sq = (LibroSolicitudesVistas.objects
               .filter(id_usuario_id=user_id, id_libro=OuterRef("pk"))
               .values("ultimo_visto_id_intercambio")[:1])

    qs = (Libro.objects
          .filter(id_usuario_id=user_id)
          .annotate(first_image=Coalesce(Subquery(portada_sq), Subquery(first_by_order_sq)))
          .annotate(has_si=has_si, has_ix=has_ix_any)
          .annotate(max_ix_acc=Coalesce(Subquery(max_ix_acc_sq), Value(0)))
          .annotate(max_ix_des=Coalesce(Subquery(max_ix_des_sq), Value(0)))
          .annotate(max_si=Coalesce(Subquery(max_si_sq), Value(0)))
          .annotate(max_activity_id=Greatest(F("max_ix_acc"), F("max_ix_des"), F("max_si")))
          .annotate(last_seen=Coalesce(Subquery(seen_sq), Value(0)))
          .order_by("-fecha_subida", "-id_libro"))

    # comuna del dueño (para las cards)
    from core.models import Usuario
    u = Usuario.objects.filter(pk=user_id).select_related("comuna").first()
    comuna_nombre = getattr(getattr(u, "comuna", None), "nombre", None)

    # ¿En qué libros hay un intercambio Completado (en cualquiera de los dos roles)?
    book_ids = list(qs.values_list("id_libro", flat=True))
    completed_acc = set(
        Intercambio.objects.filter(
            estado_intercambio="Completado",
            id_libro_ofrecido_aceptado_id__in=book_ids
        ).values_list("id_libro_ofrecido_aceptado_id", flat=True)
    )
    completed_des = set(
        Intercambio.objects.filter(
            estado_intercambio="Completado",
            id_solicitud__id_libro_deseado_id__in=book_ids
        ).values_list("id_solicitud__id_libro_deseado_id", flat=True)
    )
    completed_any = completed_acc | completed_des

    data = []
    for b in qs:
        img_rel = (b.first_image or "").replace("\\", "/")
        has_new = int(getattr(b, "max_activity_id", 0) or 0) > int(getattr(b, "last_seen", 0) or 0)
        editable = bool(b.disponible) and (b.id_libro not in completed_any)

        data.append({
            "id": b.id_libro,
            "titulo": b.titulo,
            "autor": b.autor,
            "estado": b.estado,
            "descripcion": b.descripcion,
            "editorial": b.editorial,
            "genero_nombre": getattr(getattr(b, "id_genero", None), "nombre", None),
            "tipo_tapa": b.tipo_tapa,
            "disponible": bool(b.disponible),
            "fecha_subida": b.fecha_subida,
            "first_image": media_abs(request, img_rel),
            "has_requests": bool(getattr(b, "has_si", False) or getattr(b, "has_ix", False)),
            "has_new_requests": bool(has_new),
            "comuna_nombre": comuna_nombre,
            "editable": editable,  # 👈 ahora lo mandamos explícito
        })
    return Response(data)
# =========================
# Mis libros con historial (contadores + feed por libro)
# =========================
@api_view(["GET"])
@permission_classes([AllowAny])
def my_books_with_history(request):
    """
    GET /api/libros/mis-libros-con-historial/?user_id=123[&limit=10]

    Incluye:
      - mismos campos de `my_books`
      - counters por libro: total, completados, pendientes, aceptados, rechazados
      - history (hasta `limit` items por libro), cada item:
        { id (solicitud), intercambio_id, estado, fecha, rol,
          counterpart_user_id, counterpart_user, counterpart_book_id, counterpart_book }
      - editable (igual que `my_books`)
    """
    user_id = request.query_params.get("user_id")
    if not user_id:
        return Response({"detail": "Falta user_id"}, status=400)

    try:
        limit = int(request.query_params.get("limit", 10)) or 10
    except Exception:
        limit = 10

    # ======= Base: misma info que my_books =======
    # Portada o primera imagen
    portada_sq = (ImagenLibro.objects
                  .filter(id_libro=OuterRef("pk"), is_portada=True)
                  .order_by("id_imagen").values_list("url_imagen", flat=True)[:1])

    first_by_order_sq = (ImagenLibro.objects
                         .filter(id_libro=OuterRef("pk"))
                         .order_by("orden", "id_imagen").values_list("url_imagen", flat=True)[:1])

    # Flags de existencia
    has_si = Exists(SolicitudIntercambio.objects.filter(id_libro_deseado=OuterRef("pk")))
    has_ix_any = Exists(
        Intercambio.objects.filter(
            Q(id_libro_ofrecido_aceptado=OuterRef("pk")) |
            Q(id_solicitud__id_libro_deseado=OuterRef("pk"))
        )
    )

    # Máximos de actividad (IDs) en ambos roles
    max_ix_acc_sq = (Intercambio.objects
                     .filter(id_libro_ofrecido_aceptado=OuterRef("pk"))
                     .values("id_libro_ofrecido_aceptado")
                     .annotate(m=Max("id_intercambio")).values("m")[:1])

    max_ix_des_sq = (Intercambio.objects
                     .filter(id_solicitud__id_libro_deseado=OuterRef("pk"))
                     .values("id_solicitud__id_libro_deseado")
                     .annotate(m=Max("id_intercambio")).values("m")[:1])

    max_si_sq = (SolicitudIntercambio.objects
                 .filter(id_libro_deseado=OuterRef("pk"))
                 .values("id_libro_deseado")
                 .annotate(m=Max("id_solicitud")).values("m")[:1])

    # "Último visto"
    seen_sq = (LibroSolicitudesVistas.objects
               .filter(id_usuario_id=user_id, id_libro=OuterRef("pk"))
               .values("ultimo_visto_id_intercambio")[:1])

    qs = (Libro.objects
          .filter(id_usuario_id=user_id)
          .select_related("id_genero", "id_usuario")
          .annotate(first_image=Coalesce(Subquery(portada_sq), Subquery(first_by_order_sq)))
          .annotate(has_si=has_si, has_ix=has_ix_any)
          .annotate(max_ix_acc=Coalesce(Subquery(max_ix_acc_sq), Value(0)))
          .annotate(max_ix_des=Coalesce(Subquery(max_ix_des_sq), Value(0)))
          .annotate(max_si=Coalesce(Subquery(max_si_sq), Value(0)))
          .annotate(max_activity_id=Greatest(F("max_ix_acc"), F("max_ix_des"), F("max_si")))
          .annotate(last_seen=Coalesce(Subquery(seen_sq), Value(0)))
          .order_by("-fecha_subida", "-id_libro"))

    # comuna del dueño (para las cards)
    from core.models import Usuario
    u = Usuario.objects.filter(pk=user_id).select_related("comuna").first()
    comuna_nombre = getattr(getattr(u, "comuna", None), "nombre", None)

    # ¿En qué libros hay un intercambio Completado (en cualquiera de los dos roles)?
    book_ids = list(qs.values_list("id_libro", flat=True))
    completed_acc = set(
        Intercambio.objects.filter(
            estado_intercambio="Completado",
            id_libro_ofrecido_aceptado_id__in=book_ids
        ).values_list("id_libro_ofrecido_aceptado_id", flat=True)
    )
    completed_des = set(
        Intercambio.objects.filter(
            estado_intercambio="Completado",
            id_solicitud__id_libro_deseado_id__in=book_ids
        ).values_list("id_solicitud__id_libro_deseado_id", flat=True)
    )
    completed_any = completed_acc | completed_des

    # ======= Armado de historial (ambos roles) =======
    # Rol "deseado": solicitudes que apuntan a mis libros
    # Anotamos si existe intercambio (id + estado) para mapear estado unificado
    ix_for_si_id = Intercambio.objects.filter(id_solicitud=OuterRef("pk")).values("id_intercambio")[:1]
    ix_for_si_estado = Intercambio.objects.filter(id_solicitud=OuterRef("pk")).values("estado_intercambio")[:1]
    ix_for_si_fecha = (Intercambio.objects
                       .filter(id_solicitud=OuterRef("pk"))
                       .annotate(ff=Coalesce("fecha_completado",
                                             "fecha_intercambio_pactada"))
                       .values("ff")[:1])

    si_qs = (SolicitudIntercambio.objects
             .filter(id_libro_deseado_id__in=book_ids)
             .select_related("id_usuario_solicitante",
                             "id_libro_ofrecido_aceptado",
                             "id_libro_deseado")
             .annotate(ix_id=Subquery(ix_for_si_id))
             .annotate(ix_estado=Subquery(ix_for_si_estado))
             .annotate(fecha_calc=Coalesce(Subquery(ix_for_si_fecha),
                                           F("fecha_intercambio_pactada"),
                                           F("actualizada_en"),
                                           F("creada_en")))
             .order_by("-fecha_calc", "-id_solicitud"))

    # Rol "ofrecido": intercambios donde mi libro fue el ofrecido_aceptado
    ix_qs = (Intercambio.objects
             .filter(id_libro_ofrecido_aceptado_id__in=book_ids)
             .select_related("id_solicitud",
                             "id_solicitud__id_usuario_receptor",
                             "id_solicitud__id_libro_deseado")
             .annotate(fecha_calc=Coalesce(F("fecha_completado"),
                                           F("fecha_intercambio_pactada"),
                                           F("id_solicitud__fecha_intercambio_pactada"),
                                           F("id_solicitud__actualizada_en"),
                                           F("id_solicitud__creada_en")))
             .order_by("-fecha_calc", "-id_intercambio"))

    # Map para unificar estados (cuando no hay intercambio aún)
    estado_map = {
        "Pendiente": "Pendiente",
        "Aceptada":  "Aceptado",
        "Rechazada": "Rechazado",
        "Cancelada": "Cancelado",
    }

    # Acumuladores por libro
    from collections import defaultdict
    items_by_book = defaultdict(list)

    # Construye items "deseado"
    for si in si_qs:
        b_id = si.id_libro_deseado_id
        interc_id = si.ix_id
        estado_unificado = (si.ix_estado or estado_map.get(si.estado, si.estado)) or "Pendiente"

        items_by_book[b_id].append({
            "id": si.id_solicitud,
            "intercambio_id": interc_id,
            "estado": estado_unificado,
            "fecha": si.fecha_calc,
            "rol": "deseado",
            "counterpart_user_id": getattr(si.id_usuario_solicitante, "id_usuario", None),
            "counterpart_user": getattr(si.id_usuario_solicitante, "nombre_usuario", None),
            "counterpart_book_id": getattr(si.id_libro_ofrecido_aceptado, "id_libro", None),
            "counterpart_book": getattr(si.id_libro_ofrecido_aceptado, "titulo", None),
        })

    # Construye items "ofrecido"
    for ix in ix_qs:
        b_id = ix.id_libro_ofrecido_aceptado_id
        si = ix.id_solicitud  # objeto relacionado
        items_by_book[b_id].append({
            "id": getattr(si, "id_solicitud", None),
            "intercambio_id": ix.id_intercambio,
            "estado": ix.estado_intercambio,
            "fecha": ix.fecha_calc,
            "rol": "ofrecido",
            "counterpart_user_id": getattr(getattr(si, "id_usuario_receptor", None), "id_usuario", None),
            "counterpart_user": getattr(getattr(si, "id_usuario_receptor", None), "nombre_usuario", None),
            "counterpart_book_id": getattr(getattr(si, "id_libro_deseado", None), "id_libro", None),
            "counterpart_book": getattr(getattr(si, "id_libro_deseado", None), "titulo", None),
        })

    # ======= Ensamblado final por libro =======
    data = []
    for b in qs:
        img_rel = (b.first_image or "").replace("\\", "/")
        has_new = int(getattr(b, "max_activity_id", 0) or 0) > int(getattr(b, "last_seen", 0) or 0)
        editable = bool(b.disponible) and (b.id_libro not in completed_any)

        # ordenar historial y truncar por limit
        raw_items = sorted(items_by_book.get(b.id_libro, []),
                           key=lambda x: (x["fecha"] or timezone.now()),
                           reverse=True)[:limit]

        # counters
        counters = {
            "total": len(raw_items),
            "completados": sum(1 for it in raw_items if it["estado"] == "Completado"),
            "pendientes":  sum(1 for it in raw_items if it["estado"] == "Pendiente"),
            "aceptados":   sum(1 for it in raw_items if it["estado"] == "Aceptado"),
            "rechazados":  sum(1 for it in raw_items if it["estado"] == "Rechazado"),
        }

        data.append({
            "id": b.id_libro,
            "titulo": b.titulo,
            "autor": b.autor,
            "estado": b.estado,
            "descripcion": b.descripcion,
            "editorial": b.editorial,
            "genero_nombre": getattr(getattr(b, "id_genero", None), "nombre", None),
            "tipo_tapa": b.tipo_tapa,
            "disponible": bool(b.disponible),
            "fecha_subida": b.fecha_subida,
            "first_image": media_abs(request, img_rel),
            "has_requests": bool(getattr(b, "has_si", False) or getattr(b, "has_ix", False)),
            "has_new_requests": bool(has_new),
            "comuna_nombre": comuna_nombre,
            "editable": editable,

            "counters": counters,
            "history": raw_items,
        })

    return Response(data)

@api_view(["POST"])
@permission_classes([AllowAny])
def marcar_solicitudes_vistas(request, libro_id: int):
    user_id = request.query_params.get("user_id")
    if not user_id:
        return Response({"detail": "Falta user_id"}, status=400)

    libro = Libro.objects.filter(pk=libro_id, id_usuario_id=user_id).first()
    if not libro:
        return Response({"detail": "Libro no encontrado o no pertenece al usuario"}, status=404)

    # Máximos en ambos roles
    max_ix_acc = (Intercambio.objects
                  .filter(id_libro_ofrecido_aceptado_id=libro_id)
                  .aggregate(m=Max("id_intercambio"))["m"] or 0)

    max_ix_des = (Intercambio.objects
                  .filter(id_solicitud__id_libro_deseado_id=libro_id)
                  .aggregate(m=Max("id_intercambio"))["m"] or 0)

    max_si = (SolicitudIntercambio.objects
              .filter(id_libro_deseado_id=libro_id)
              .aggregate(m=Max("id_solicitud"))["m"] or 0)

    composite_max = max(int(max_ix_acc or 0), int(max_ix_des or 0), int(max_si or 0))

    obj, _ = LibroSolicitudesVistas.objects.update_or_create(
        id_usuario_id=user_id, id_libro_id=libro_id,
        defaults={
            "ultimo_visto_id_intercambio": composite_max,
            "visto_por_ultima_vez": timezone.now(),
        }
    )
    return Response({"ok": True, "ultimo_visto_id_intercambio": obj.ultimo_visto_id_intercambio})


@api_view(["PATCH"])
@permission_classes([AllowAny])
def update_book(request, libro_id: int):
    libro = Libro.objects.filter(pk=libro_id).first()
    if not libro:
        return Response({"detail": "Libro no encontrado."}, status=404)

    # 🔒 Si el libro aparece en un intercambio COMPLETADO (en cualquier rol), no se puede editar
    locked = Intercambio.objects.filter(
        estado_intercambio="Completado"
    ).filter(
        Q(id_libro_ofrecido_aceptado_id=libro_id) |
        Q(id_solicitud__id_libro_deseado_id=libro_id)
    ).exists()

    if locked:
        return Response(
            {"detail": "No se puede editar: el libro ya está asociado a un intercambio 'Completado'."},
            status=status.HTTP_409_CONFLICT
        )

    allowed = {
        "titulo", "autor", "isbn", "anio_publicacion", "estado",
        "descripcion", "editorial", "tipo_tapa", "disponible", "id_genero"
    }
    changed = []
    data = request.data

    # Helpers de casteo
    def to_bool(v):
        if isinstance(v, bool):
            return v
        s = str(v).strip().lower()
        if s in ("1", "true", "t", "yes", "y", "on"):
            return True
        if s in ("0", "false", "f", "no", "n", "off"):
            return False
        # si llega algo raro, lo dejamos tal cual para que DB valide
        return v

    for field in allowed:
        if field not in data:
            continue

        val = data.get(field)

        if field == "anio_publicacion" and val not in (None, ""):
            try:
                val = int(val)
            except Exception:
                return Response({"detail": "anio_publicacion inválido."}, status=400)
            setattr(libro, field, val)
            changed.append(field)

        elif field == "id_genero" and val not in (None, ""):
            try:
                gen_id = int(val)
            except Exception:
                return Response({"detail": "id_genero inválido."}, status=400)

            # valida existencia del género para evitar error de FK
            if not Genero.objects.filter(pk=gen_id).exists():
                return Response({"detail": "id_genero no existe."}, status=400)

            libro.id_genero_id = gen_id
            changed.append("id_genero")

        elif field == "disponible":
            # Normaliza a boolean
            libro.disponible = to_bool(val)
            changed.append("disponible")

        else:
            # strings / enums tal cual (DB validará)
            setattr(libro, field, val)
            changed.append(field)

    if changed:
        try:
            # Nota: para FK usamos el nombre del campo (id_genero), no *_id
            # Django resuelve la columna correcta.
            libro.save(update_fields=list(set(changed)))
        except IntegrityError as e:
            return Response({"detail": f"Restricción de integridad: {e}"}, status=400)
        except Exception as e:
            return Response({"detail": f"No se pudo actualizar: {e}"}, status=400)

    return Response({
        "id": libro.id_libro,
        "titulo": libro.titulo,
        "autor": libro.autor,
        "isbn": libro.isbn,
        "anio_publicacion": libro.anio_publicacion,
        "estado": libro.estado,
        "descripcion": libro.descripcion,
        "editorial": libro.editorial,
        "tipo_tapa": libro.tipo_tapa,
        "id_genero": libro.id_genero_id,
        "genero_nombre": getattr(getattr(libro, "id_genero", None), "nombre", None),
        "disponible": bool(libro.disponible),
        "fecha_subida": libro.fecha_subida,
    }, status=status.HTTP_200_OK)

from django.db import transaction, IntegrityError
from django.utils import timezone
from django.db.models import Q

@api_view(["DELETE"])
@permission_classes([AllowAny])  # en prod: IsAuthenticated
def delete_book(request, libro_id: int):
    libro = Libro.objects.select_related('id_usuario').filter(pk=libro_id).first()
    if not libro:
        return Response({"detail": "Libro no encontrado."}, status=404)

    # (Opcional) Sólo el dueño puede borrar
    # user_id = request.query_params.get("user_id")
    # if not user_id or int(user_id) != libro.id_usuario_id:
    #     return Response({"detail": "No autorizado."}, status=403)

    # 🔒 Bloquea si el libro aparece en un intercambio COMPLETADO (en cualquier rol)
    completed = (
        Intercambio.objects
        .filter(estado_intercambio="Completado")
        .filter(
            Q(id_libro_ofrecido_aceptado_id=libro_id) |
            Q(id_solicitud__id_libro_deseado_id=libro_id)
        )
        .exists()
    )
    if completed:
        return Response(
            {"detail": "No se puede eliminar: el libro participa en un intercambio 'Completado'."},
            status=status.HTTP_409_CONFLICT
        )

    try:
        with transaction.atomic():
            # =========================================================
            # 1) Intercambios donde este libro fue el ACEPTADO (no completados)
            #    → actualizar solicitud y borrar intercambio
            # =========================================================
            inter_qs = (
                Intercambio.objects
                .select_for_update()
                .filter(id_libro_ofrecido_aceptado_id=libro_id)
                .exclude(estado_intercambio="Completado")
            )

            # Aceptados → Cancelada
            inter_acc = list(
                inter_qs.filter(estado_intercambio="Aceptado")
                        .values_list("id_intercambio", "id_solicitud_id")
            )
            if inter_acc:
                inter_ids = [i for (i, _) in inter_acc]
                sol_ids   = [s for (_, s) in inter_acc]
                SolicitudIntercambio.objects.filter(pk__in=sol_ids).update(
                    estado="Cancelada", actualizada_en=timezone.now()
                )
                Intercambio.objects.filter(pk__in=inter_ids).delete()

            # Pendientes → Rechazada (por si existieran)
            inter_pen = list(
                inter_qs.filter(estado_intercambio="Pendiente")
                        .values_list("id_intercambio", "id_solicitud_id")
            )
            if inter_pen:
                inter_ids = [i for (i, _) in inter_pen]
                sol_ids   = [s for (_, s) in inter_pen]
                SolicitudIntercambio.objects.filter(pk__in=sol_ids).update(
                    estado="Rechazada", actualizada_en=timezone.now()
                )
                Intercambio.objects.filter(pk__in=inter_ids).delete()

            # =========================================================
            # 2) Solicitudes donde este libro es el DESEADO (activas)
            #    → Aceptadas → Cancelada ; Pendientes → Rechazada
            # =========================================================
            sol_qs = (
                SolicitudIntercambio.objects
                .select_for_update()
                .filter(id_libro_deseado_id=libro_id)
                .exclude(estado__in=["Rechazada", "Cancelada"])
            )

            sol_aceptadas_ids = list(
                sol_qs.filter(estado="Aceptada").values_list("id_solicitud", flat=True)
            )
            if sol_aceptadas_ids:
                SolicitudIntercambio.objects.filter(pk__in=sol_aceptadas_ids).update(
                    estado="Cancelada", actualizada_en=timezone.now()
                )
                Intercambio.objects.filter(id_solicitud_id__in=sol_aceptadas_ids).exclude(
                    estado_intercambio="Completado"
                ).delete()

            sol_pend_ids = list(
                sol_qs.filter(estado="Pendiente").values_list("id_solicitud", flat=True)
            )
            if sol_pend_ids:
                SolicitudIntercambio.objects.filter(pk__in=sol_pend_ids).update(
                    estado="Rechazada", actualizada_en=timezone.now()
                )
                Intercambio.objects.filter(id_solicitud_id__in=sol_pend_ids).delete()

            # =========================================================
            # 3) Limpiar dependencias sin CASCADE
            # =========================================================
            try:
                from .models import Favorito
                Favorito.objects.filter(id_libro_id=libro_id).delete()
            except Exception:
                pass

            LibroSolicitudesVistas.objects.filter(id_libro_id=libro_id).delete()

            for im in ImagenLibro.objects.filter(id_libro_id=libro_id):
                rel = (im.url_imagen or '').replace('\\', '/')
                im.delete()
                try:
                    if rel:
                        default_storage.delete(rel)
                except Exception:
                    pass

            # =========================================================
            # 4) Finalmente, eliminar el libro
            # =========================================================
            libro.delete()

        return Response(status=204)

    except IntegrityError as e:
        return Response({"detail": f"Restricción de integridad: {e}"}, status=400)
    except Exception as e:
        return Response({"detail": f"No se pudo eliminar: {e}"}, status=400)



# =========================
# Intercambios (solicitudes)
# =========================
@api_view(["POST"])
@permission_classes([AllowAny])  # cambia a IsAuthenticated en prod
def crear_intercambio(request):
    """
    Bridge legacy:
    Crea una SolicitudIntercambio con 1 oferta, la marca ACEPTADA y crea el Intercambio.
    Body:
    {
      "id_usuario_solicitante": 1,
      "id_libro_ofrecido": 101,      # del solicitante
      "id_usuario_ofreciente": 2,    # dueño del libro solicitado
      "id_libro_solicitado": 104,
      "lugar_intercambio": "Metro ...",
      "fecha_intercambio": "YYYY-MM-DD"  # opcional
    }
    """
    from .models import SolicitudIntercambio, SolicitudOferta, Libro, Intercambio, Conversacion, ConversacionParticipante
    data = request.data

    try:
        uid_sol = int(data.get("id_usuario_solicitante"))
        uid_ofr = int(data.get("id_usuario_ofreciente"))
        libro_ofr_id = int(data.get("id_libro_ofrecido"))
        libro_sol_id = int(data.get("id_libro_solicitado"))
    except (TypeError, ValueError):
        return Response({"detail": "IDs inválidos."}, status=400)

    if uid_sol == uid_ofr or libro_ofr_id == libro_sol_id:
        return Response({"detail": "IDs inconsistentes."}, status=400)

    lo = Libro.objects.filter(pk=libro_ofr_id, id_usuario_id=uid_sol, disponible=True).first()
    ls = Libro.objects.filter(pk=libro_sol_id, id_usuario_id=uid_ofr, disponible=True).first()
    if not lo or not ls:
        return Response({"detail": "Libros no válidos o no disponibles."}, status=400)

    fecha = None
    raw_fecha = (data.get("fecha_intercambio") or "").strip()
    if raw_fecha:
        try:
            fecha = date.fromisoformat(raw_fecha)
        except Exception:
            return Response({"detail": "fecha_intercambio inválida (YYYY-MM-DD)."}, status=400)

    lugar = (data.get("lugar_intercambio") or "A coordinar").strip()[:255]

    # Guards: no permitir duplicadas aceptadas o pendientes iguales
    if Intercambio.objects.filter(
        id_solicitud__id_libro_deseado_id=libro_sol_id,
        estado_intercambio__iexact="Aceptado",
    ).exists():
        return Response({"detail": "El libro solicitado ya está comprometido en un intercambio aceptado."}, status=409)

    with transaction.atomic():
        # crear solicitud + oferta
        si = SolicitudIntercambio.objects.create(
            id_usuario_solicitante_id=uid_sol,
            id_usuario_receptor_id=uid_ofr,
            id_libro_deseado_id=libro_sol_id,
            estado="Aceptada",
            creada_en=timezone.now(),
            actualizada_en=timezone.now(),
            lugar_intercambio=lugar,
            fecha_intercambio_pactada=fecha,
        )
        SolicitudOferta.objects.create(id_solicitud=si, id_libro_ofrecido_id=libro_ofr_id)
        si.id_libro_ofrecido_aceptado_id = libro_ofr_id
        si.save(update_fields=["id_libro_ofrecido_aceptado"])

        ix, _ = Intercambio.objects.get_or_create(
            id_solicitud=si,
            defaults={
                "id_libro_ofrecido_aceptado_id": libro_ofr_id,
                "estado_intercambio": "Aceptado",
                "lugar_intercambio": lugar,
                "fecha_intercambio_pactada": fecha,
            },
        )

        # conversación
        conv, _ = Conversacion.objects.get_or_create(
            id_intercambio_id=ix.id_intercambio,
            defaults={"creado_en": timezone.now(), "actualizado_en": timezone.now(), "ultimo_id_mensaje": 0},
        )
        ConversacionParticipante.objects.get_or_create(
            id_conversacion_id=conv.id_conversacion, id_usuario_id=uid_sol,
            defaults={"rol": "solicitante", "ultimo_visto_id_mensaje": 0, "silenciado": False, "archivado": False},
        )
        ConversacionParticipante.objects.get_or_create(
            id_conversacion_id=conv.id_conversacion, id_usuario_id=uid_ofr,
            defaults={"rol": "ofreciente", "ultimo_visto_id_mensaje": 0, "silenciado": False, "archivado": False},
        )

    return Response({"id_intercambio": ix.id_intercambio}, status=201)

@api_view(["PATCH"])
@permission_classes([AllowAny])  # cambia a IsAuthenticated en prod
def responder_intercambio(request, intercambio_id: int):
    """
    Acepta o Rechaza una solicitud.
    Body JSON: { "estado": "Aceptado" }  # o "Rechazado"
    """
    estado = (request.data.get("estado") or "").capitalize()
    if estado not in ("Aceptado", "Rechazado"):
        return Response({"detail": "Estado inválido"}, status=400)

    it = Intercambio.objects.filter(pk=intercambio_id).first()
    if not it:
        return Response({"detail": "Intercambio no encontrado"}, status=404)

    it.estado_intercambio = estado
    it.save(update_fields=["estado_intercambio"])
    return Response({"ok": True})


    
@api_view(["GET"])
@permission_classes([AllowAny])
def solicitudes_entrantes(request):
    user_id = request.query_params.get("user_id")
    if not user_id:
        return Response({"detail": "Falta user_id"}, status=400)

    qs = (SolicitudIntercambio.objects
          .filter(id_usuario_receptor_id=user_id, estado="Pendiente")
          .select_related("id_usuario_solicitante", "id_libro_deseado")
          .prefetch_related(Prefetch("ofertas", queryset=SolicitudOferta.objects.select_related("id_libro_ofrecido")))
          .order_by("-id_solicitud"))

    data = []
    for s in qs:
        # primer ofrecido para mostrar algo (si hay)
        offered_title = None
        try:
            offered_title = s.ofertas.all()[0].id_libro_ofrecido.titulo
        except Exception:
            pass

        data.append({
            "id_solicitud": s.id_solicitud,
            "solicitante": getattr(s.id_usuario_solicitante, "nombre_usuario", None),
            "libro_mio": getattr(s.id_libro_deseado, "titulo", None),
            "libro_del_otro": offered_title,
            "lugar": s.lugar_intercambio or "A coordinar",
            "fecha": s.fecha_intercambio_pactada,
            "estado": s.estado,
        })
    return Response(data)

@api_view(["GET"])
@permission_classes([AllowAny])
def books_by_title(request):
    """
    GET /api/libros/by-title/?title=El%20Principito
    Devuelve todas las publicaciones con ese título EXACTO (case-insensitive)
    incluyendo dueño + reputación y una imagen de portada si existe.
    """
    title = (request.query_params.get("title") or "").strip()
    if not title:
        return Response({"detail": "Falta title"}, status=400)

    # Subqueries: portada o primera imagen
    portada_sq = (ImagenLibro.objects
        .filter(id_libro=OuterRef("pk"), is_portada=True)
        .order_by("id_imagen").values_list("url_imagen", flat=True)[:1])
    first_by_order_sq = (ImagenLibro.objects
        .filter(id_libro=OuterRef("pk"))
        .order_by("orden", "id_imagen").values_list("url_imagen", flat=True)[:1])

    # Reputación del dueño (promedio y cantidad)
    from .models import Calificacion
    avg_sq = (Calificacion.objects
              .filter(id_usuario_calificado=OuterRef("id_usuario_id"))
              .values("id_usuario_calificado")
              .annotate(a=Avg("puntuacion"))
              .values("a")[:1])
    cnt_sq = (Calificacion.objects
              .filter(id_usuario_calificado=OuterRef("id_usuario_id"))
              .values("id_usuario_calificado")
              .annotate(c=Count("pk"))
              .values("c")[:1])

    qs = (Libro.objects
          .filter(titulo__iexact=title)
          .select_related("id_usuario")
          .annotate(first_image=Coalesce(Subquery(portada_sq), Subquery(first_by_order_sq)))
          .annotate(owner_rating_avg=Coalesce(Subquery(avg_sq), Value(None)))
          .annotate(owner_rating_count=Coalesce(Subquery(cnt_sq), Value(0)))
          .order_by("-fecha_subida", "-id_libro"))

    data = []
    for b in qs:
        rel = (b.first_image or "").replace("\\", "/")
        data.append({
            "id": b.id_libro,
            "titulo": b.titulo,
            "autor": b.autor,
            "estado": b.estado,
            "fecha_subida": b.fecha_subida,
            "disponible": bool(b.disponible),
            "first_image": media_abs(request, rel) if rel else None,
            "genero_nombre": getattr(getattr(b, "id_genero", None), "nombre", None),
            "owner": {
                "id": getattr(b.id_usuario, "id_usuario", None),
                "nombre_usuario": getattr(b.id_usuario, "nombre_usuario", None),
                "rating_avg": float(b.owner_rating_avg) if b.owner_rating_avg is not None else None,
                "rating_count": int(b.owner_rating_count or 0),
            }
        })
    return Response(data)


def _conv_payload(conv_id: int, me_id: int):
    last = (ConversacionMensaje.objects
            .filter(id_conversacion_id=conv_id)
            .only('cuerpo', 'enviado_en', 'id_mensaje')
            .order_by('-id_mensaje')
            .first())

    # “El otro” participante
    par = (ConversacionParticipante.objects
           .filter(id_conversacion_id=conv_id)
           .exclude(id_usuario_id=me_id)
           .select_related('id_usuario')
           .first())
    other = getattr(par, 'id_usuario', None)

    return {
        "id_conversacion": conv_id,
        "ultimo_mensaje": getattr(last, 'cuerpo', None),
        "ultimo_enviado_en": getattr(last, 'enviado_en', None),
        "ultimo_id_mensaje": getattr(last, 'id_mensaje', None),
        "otro_usuario": {
            "id_usuario": getattr(other, 'id_usuario', None),
            "nombre_usuario": getattr(other, 'nombre_usuario', None),
            "nombres": getattr(other, 'nombres', None),
            "imagen_perfil": getattr(other, 'imagen_perfil', None),
        },
        # opcional: si luego quieres unread_count real, puedes calcularlo con conversacion_participante. 
    }

@api_view(['GET'])
@permission_classes([AllowAny])
def lista_conversaciones(request, user_id: int):
    """
    Devuelve la lista de conversaciones del usuario con:
      - id_conversacion
      - ultimo_enviado_en
      - ultimo_mensaje
      - otro_usuario{ id_usuario, nombre_usuario, nombres, imagen_perfil }
      - unread_count
    SIN reventar por valores nulos.
    """
    sql = """
    SELECT
      c.id_conversacion,
      c.actualizado_en                         AS ultimo_enviado_en,
      cm.cuerpo                                AS ultimo_mensaje,
      me.rol                                   AS my_role,                 -- 👈 NUEVO
      other_u.id_usuario                       AS otro_usuario_id,
      other_u.nombre_usuario                   AS nombre_usuario,
      other_u.nombres                          AS nombres,
      other_u.imagen_perfil                    AS imagen_perfil,
      c.titulo                                 AS titulo_chat,
      i.id_intercambio                         AS id_intercambio,
      lo.titulo                                AS libro_ofrecido_titulo,   -- 👈 NUEVO (del solicitante)
      ls.titulo                                AS libro_solicitado_titulo, -- 👈 ya estaba como ls
      GREATEST(COALESCE(c.ultimo_id_mensaje,0) - COALESCE(me.ultimo_visto_id_mensaje,0), 0) AS unread_count
    FROM conversacion c
    JOIN conversacion_participante me
      ON me.id_conversacion = c.id_conversacion
     AND me.id_usuario      = %s
     AND me.archivado       = 0
    LEFT JOIN conversacion_participante other_p
      ON other_p.id_conversacion = c.id_conversacion
     AND other_p.id_usuario     <> %s
    LEFT JOIN usuario other_u
      ON other_u.id_usuario = other_p.id_usuario
    LEFT JOIN conversacion_mensaje cm
      ON cm.id_mensaje = c.ultimo_id_mensaje
    LEFT JOIN intercambio i
      ON i.id_intercambio = c.id_intercambio
    LEFT JOIN solicitud_intercambio si
      ON si.id_solicitud = i.id_solicitud
    LEFT JOIN libro ls
      ON ls.id_libro = si.id_libro_deseado
    LEFT JOIN libro lo
      ON lo.id_libro = i.id_libro_ofrecido_aceptado
    ORDER BY c.actualizado_en DESC
    """

    with connection.cursor() as cur:
        cur.execute(sql, [user_id, user_id])
        cols = [c[0] for c in cur.description]
        raw = [dict(zip(cols, r)) for r in cur.fetchall()]

    # Armar el payload exactamente como espera tu ChatService
    data = []
    for r in raw:
        nombre = r["nombre_usuario"] or r["nombres"] or None
        # Determinar mis/otros libros según mi rol
        if (r.get("my_role") or "").lower() == "solicitante":
            my_book = r.get("libro_ofrecido_titulo")
            other_book = r.get("libro_solicitado_titulo")
        else:  # ofreciente
            my_book = r.get("libro_solicitado_titulo")
            other_book = r.get("libro_ofrecido_titulo")

        avatar_rel = r["imagen_perfil"] or "avatars/avatardefecto.jpg"
        display_title = nombre or r["titulo_chat"] or "Conversación"

        data.append({
            "id_conversacion": r["id_conversacion"],
            "ultimo_enviado_en": r["ultimo_enviado_en"],
            "ultimo_mensaje": r["ultimo_mensaje"],
            "otro_usuario": {
                "id_usuario": r["otro_usuario_id"],
                "nombre_usuario": r["nombre_usuario"],
                "nombres": r["nombres"],
                "imagen_perfil": media_abs(request, avatar_rel),
            },
            "titulo_chat": r["titulo_chat"],
            "display_title": display_title,         # opcional
            "requested_book_title": r.get("libro_solicitado_titulo"),  # por si lo sigues usando
            "my_book_title": my_book,               # 👈 NUEVO
            "counterpart_book_title": other_book,   # 👈 NUEVO
            "unread_count": r["unread_count"] or 0,
        })
    return Response(data)


@api_view(["POST"])
@permission_classes([AllowAny])
def calificar_intercambio(request, intercambio_id: int):
    it = (Intercambio.objects
          .select_related("id_solicitud")
          .filter(pk=intercambio_id).first())
    if not it:
        return Response({"detail": "Intercambio no encontrado"}, status=404)

    if (it.estado_intercambio or "").lower() != "completado":
        return Response({"detail": "Solo se puede calificar tras completar el intercambio."}, status=400)

    # IDs y datos
    try:
        user_id = int(request.data.get("user_id"))
        puntuacion = int(request.data.get("puntuacion"))
    except (TypeError, ValueError):
        return Response({"detail": "user_id/puntuacion inválidos."}, status=400)

    # Comentario opcional, NUNCA None
    raw_com = request.data.get("comentario")
    comentario = (raw_com if isinstance(raw_com, str) else "").strip()[:500]

    solicitante_id, ofreciente_id = _roles(it)
    if user_id not in (solicitante_id, ofreciente_id):
        return Response({"detail": "No autorizado."}, status=403)
    if not (1 <= puntuacion <= 5):
        return Response({"detail": "La puntuación debe ser de 1 a 5."}, status=400)

    calificado_id = ofreciente_id if user_id == solicitante_id else solicitante_id

    # ➜ SOLO UNA CALIFICACIÓN por (intercambio, calificador)
    from .models import Calificacion
    obj, created = Calificacion.objects.get_or_create(
        id_intercambio_id=intercambio_id,
        id_usuario_calificador_id=user_id,
        defaults={
            "id_usuario_calificado_id": calificado_id,
            "puntuacion": puntuacion,
            "comentario": comentario or "",  # NOT NULL
        }
    )
    if not created:
        return Response({"detail": "Ya calificaste este intercambio. No puedes calificar nuevamente."},
                        status=409)

    return Response({"ok": True})



@api_view(['GET'])
@permission_classes([AllowAny])
def mensajes_de_conversacion(request, conversacion_id: int):
    # base: todos los mensajes de la conversación en orden ASC por id
    qs = (ConversacionMensaje.objects
          .filter(id_conversacion_id=conversacion_id)
          .order_by('id_mensaje'))

    # soporta ?after= / ?after_id= (solo mensajes nuevos)
    after = request.query_params.get('after') or request.query_params.get('after_id')
    if after:
        try:
            after_i = int(after)
            qs = qs.filter(id_mensaje__gt=after_i)
        except (TypeError, ValueError):
            pass  # ignoramos 'after' inválido y devolvemos todo

    data = [{
        "id_mensaje": m.id_mensaje,
        "emisor_id": m.id_usuario_emisor_id,
        "cuerpo": m.cuerpo,
        "enviado_en": m.enviado_en,
        "eliminado": m.eliminado,
        # opcional si existe en tu modelo:
        # "editado_en": getattr(m, "editado_en", None),
    } for m in qs]

    return Response(data, status=200)


@api_view(['POST'])
@permission_classes([AllowAny])
def enviar_mensaje(request, conversacion_id: int):
    emisor_id = int(request.data.get('id_usuario_emisor'))
    cuerpo = (request.data.get('cuerpo') or '').strip()
    if not cuerpo:
        return Response({"detail": "Mensaje vacío."}, status=400)

    # 👇 traemos el intercambio y validamos estado
    conv = (Conversacion.objects
            .select_related("id_intercambio")
            .filter(pk=conversacion_id).first())
    if not conv:
        return Response({"detail": "Conversación no existe."}, status=404)

    ix = getattr(conv, "id_intercambio", None)
    if ix and (ix.estado_intercambio or "").lower() == "completado":
        return Response({"detail": "El intercambio fue completado. El chat es solo lectura."},
                        status=status.HTTP_403_FORBIDDEN)

    m = ConversacionMensaje.objects.create(
        id_conversacion=conv,
        id_usuario_emisor_id=emisor_id,
        cuerpo=cuerpo,
        enviado_en=timezone.now()
    )
    Conversacion.objects.filter(pk=conversacion_id).update(
        actualizado_en=timezone.now(),
        ultimo_id_mensaje=m.id_mensaje
    )
    return Response({"id_mensaje": m.id_mensaje}, status=201)


@api_view(['POST'])
@permission_classes([AllowAny])
def marcar_visto(request, conversacion_id: int):
    user_id = int(request.data.get('id_usuario'))
    last_id = ConversacionMensaje.objects.filter(
        id_conversacion_id=conversacion_id
    ).aggregate(max_id=Max('id_mensaje'))['max_id'] or 0

    ConversacionParticipante.objects.filter(
        id_conversacion_id=conversacion_id, id_usuario_id=user_id
    ).update(ultimo_visto_id_mensaje=last_id, visto_en=timezone.now())

    return Response({"ultimo_visto_id_mensaje": last_id})


@api_view(["POST"])
@permission_classes([AllowAny])  # Cambia a [IsAuthenticated] en prod
def crear_solicitud_intercambio(request):
    """
    Body:
    {
        "id_usuario_solicitante": 1,
        "id_libro_deseado": 104,
        "id_libros_ofrecidos": [101,102]
    }
    """
    try:
        solicitante_id = int(request.data.get("id_usuario_solicitante"))
        libro_deseado_id = int(request.data.get("id_libro_deseado"))
    except (TypeError, ValueError):
        return Response({"detail": "IDs inválidos."}, status=400)

    libros_raw = request.data.get("id_libros_ofrecidos", [])
    if not isinstance(libros_raw, list):
        return Response({"detail": "id_libros_ofrecidos debe ser una lista."}, status=400)

    libros_ofrecidos_ids = []
    for x in libros_raw:
        try:
            v = int(x)
            if v not in libros_ofrecidos_ids:
                libros_ofrecidos_ids.append(v)
        except (TypeError, ValueError):
            pass

    if not (1 <= len(libros_ofrecidos_ids) <= 3):
        return Response({"detail": "Debes ofrecer entre 1 y 3 libros."}, status=400)

    if libro_deseado_id in libros_ofrecidos_ids:
        return Response({"detail": "No puedes ofrecer el mismo libro que estás solicitando."}, status=400)

    try:
        libro_deseado = Libro.objects.get(pk=libro_deseado_id, disponible=True)
    except Libro.DoesNotExist:
        return Response({"detail": "El libro deseado no existe o no está disponible."}, status=404)

    receptor_id = libro_deseado.id_usuario_id
    if solicitante_id == receptor_id:
        return Response({"detail": "No puedes enviar una solicitud a tu propio libro."}, status=400)

    ofrecidos_qs = Libro.objects.filter(
        pk__in=libros_ofrecidos_ids,
        id_usuario_id=solicitante_id,
        disponible=True
    ).values_list("id_libro", flat=True)

    validos = set(ofrecidos_qs)
    faltantes = [lid for lid in libros_ofrecidos_ids if lid not in validos]
    if faltantes:
        return Response(
            {"detail": f"Algunos libros ofrecidos no son válidos / no te pertenecen / no están disponibles: {faltantes}"},
            status=400
        )

    # === NUEVO: bloqueo por “reservado lógico” (intercambio Aceptado) ===
    if Intercambio.objects.filter(
        id_solicitud__id_libro_deseado_id=libro_deseado_id,
        estado_intercambio__iexact=INTERCAMBIO_ESTADO["ACEPTADO"],
    ).exists():
        return Response({"detail": "Ese libro ya tiene un intercambio aceptado en curso."}, status=409)
    
    if Intercambio.objects.filter(
        Q(id_solicitud__id_libro_deseado_id=libro_deseado_id) | Q(id_libro_ofrecido_aceptado_id=libro_deseado_id),
        estado_intercambio__in=['Pendiente','Aceptado'],
    ).exists():
        return Response({"detail": "Ese libro está en negociación. No se puede proponer por ahora."}, status=409)

    if Intercambio.objects.filter(
        id_libro_ofrecido_aceptado_id__in=libros_ofrecidos_ids,
        estado_intercambio__iexact=INTERCAMBIO_ESTADO["ACEPTADO"],
    ).exists():
        return Response({"detail": "Alguno de tus libros ofrecidos ya está comprometido en un intercambio aceptado."}, status=409)

    ya_pendiente = SolicitudIntercambio.objects.filter(
        id_usuario_solicitante_id=solicitante_id,
        id_usuario_receptor_id=receptor_id,
        id_libro_deseado_id=libro_deseado_id,
        estado__iexact="pendiente",
    ).exists()
    if ya_pendiente:
        return Response({"detail": "Ya existe una solicitud pendiente para este libro."}, status=400)

    with transaction.atomic():
        solicitud = SolicitudIntercambio.objects.create(
            id_usuario_solicitante_id=solicitante_id,
            id_usuario_receptor_id=receptor_id,
            id_libro_deseado_id=libro_deseado_id,
            estado=SOLICITUD_ESTADO["PENDIENTE"],
            creada_en=timezone.now(),
            actualizada_en=timezone.now(),
        )
        for lid in libros_ofrecidos_ids:
            SolicitudOferta.objects.create(
                id_solicitud=solicitud,
                id_libro_ofrecido_id=lid
            )

    serializer = SolicitudIntercambioSerializer(solicitud)
    return Response(serializer.data, status=201)

@api_view(["GET"])
@permission_classes([AllowAny])
def libros_ofrecidos_ocupados(request):
    """
    GET /api/solicitudes/ofertas-ocupadas/?user_id=123
    Devuelve { "ocupados": [1,2,3] } con IDs de libros del solicitante
    que ya están ofrecidos en OTRA solicitud PENDIENTE.
    """
    user_id = request.query_params.get("user_id")
    if not user_id:
        return Response({"detail": "Falta user_id"}, status=400)

    ocupados = (SolicitudOferta.objects
        .filter(
            id_solicitud__id_usuario_solicitante_id=user_id,
            id_solicitud__estado__iexact=SOLICITUD_ESTADO["PENDIENTE"]
        )
        .values_list("id_libro_ofrecido_id", flat=True)
        .distinct())

    return Response({"ocupados": list(map(int, ocupados))})


@api_view(["POST"])
@permission_classes([AllowAny])
def aceptar_solicitud(request, solicitud_id):
    # --- Validaciones básicas ---
    try:
        user_id = int(request.data.get("user_id"))
    except (TypeError, ValueError):
        return Response({"detail": "user_id inválido."}, status=400)

    try:
        libro_aceptado_id = int(request.data.get("id_libro_aceptado"))
    except (TypeError, ValueError):
        return Response({"detail": "id_libro_aceptado inválido."}, status=400)

    # Traer solicitud (pendiente o ya aceptada)
    try:
        solicitud = (
            SolicitudIntercambio.objects
            .select_related("id_usuario_solicitante", "id_usuario_receptor", "id_libro_deseado")
            .get(
                pk=solicitud_id,
                estado__in=[SOLICITUD_ESTADO["PENDIENTE"], SOLICITUD_ESTADO["ACEPTADA"]],
            )
        )
    except SolicitudIntercambio.DoesNotExist:
        return Response({"detail": "La solicitud no existe o ya fue respondida."}, status=404)

    # Solo el RECEPTOR puede aceptar
    if user_id != solicitud.id_usuario_receptor_id:
        return Response({"detail": "Solo el receptor puede aceptar esta solicitud."}, status=403)

    # El libro elegido debe ser parte de la oferta
    es_de_oferta = SolicitudOferta.objects.filter(
        id_solicitud=solicitud, id_libro_ofrecido_id=libro_aceptado_id
    ).exists()
    if not es_de_oferta:
        return Response({"detail": "El libro seleccionado no es parte de la oferta original."}, status=400)

    # Ambos libros deben seguir disponibles al momento de ACEPTAR
    if not Libro.objects.filter(pk=solicitud.id_libro_deseado_id, disponible=True).exists():
        return Response({"detail": "Tu libro deseado ya no está disponible."}, status=409)
    if not Libro.objects.filter(pk=libro_aceptado_id, disponible=True).exists():
        return Response({"detail": "El libro aceptado ya no está disponible."}, status=409)

    # === Guards: evitar doble aceptación simultánea sobre estos libros ===
    if Intercambio.objects.filter(
        id_solicitud__id_libro_deseado_id=solicitud.id_libro_deseado_id,
        estado_intercambio__iexact=INTERCAMBIO_ESTADO["ACEPTADO"],
    ).exclude(id_solicitud_id=solicitud.id_solicitud).exists():
        return Response({"detail": "Ese libro ya tiene otro intercambio aceptado en curso."}, status=409)

    if Intercambio.objects.filter(
        id_libro_ofrecido_aceptado_id=libro_aceptado_id,
        estado_intercambio__iexact=INTERCAMBIO_ESTADO["ACEPTADO"],
    ).exclude(id_solicitud_id=solicitud.id_solicitud).exists():
        return Response({"detail": "El libro aceptado ya está comprometido en otro intercambio."}, status=409)

    with transaction.atomic():
        # 1) Marca la solicitud como aceptada y guarda el libro elegido
        solicitud.estado = SOLICITUD_ESTADO["ACEPTADA"]
        solicitud.id_libro_ofrecido_aceptado_id = libro_aceptado_id
        solicitud.actualizada_en = timezone.now()
        solicitud.save(update_fields=["estado", "id_libro_ofrecido_aceptado", "actualizada_en"])

        # 2) Crea/actualiza el Intercambio (no tocamos 'disponible' aquí)
        intercambio, created = Intercambio.objects.get_or_create(
            id_solicitud=solicitud,
            defaults={
                "id_libro_ofrecido_aceptado_id": libro_aceptado_id,
                "estado_intercambio": INTERCAMBIO_ESTADO["ACEPTADO"],
                "lugar_intercambio": "A coordinar",
            },
        )
        if (not created) and (
            intercambio.id_libro_ofrecido_aceptado_id != libro_aceptado_id
            or (intercambio.estado_intercambio or "").lower() != INTERCAMBIO_ESTADO["ACEPTADO"].lower()
        ):
            intercambio.id_libro_ofrecido_aceptado_id = libro_aceptado_id
            intercambio.estado_intercambio = INTERCAMBIO_ESTADO["ACEPTADO"]
            intercambio.save(update_fields=["id_libro_ofrecido_aceptado", "estado_intercambio"])

        # 3) Conversación del intercambio (con ultimo_id_mensaje=0)
        conv, _ = Conversacion.objects.get_or_create(
            id_intercambio_id=intercambio.id_intercambio,
            defaults={
                "creado_en": timezone.now(),
                "actualizado_en": timezone.now(),
                "ultimo_id_mensaje": 0,
            },
        )

        # 4) Participantes (una sola vez cada uno)
        ConversacionParticipante.objects.get_or_create(
            id_conversacion_id=conv.id_conversacion,
            id_usuario_id=solicitud.id_usuario_solicitante_id,
            defaults={"rol": "solicitante", "ultimo_visto_id_mensaje": 0, "silenciado": False, "archivado": False},
        )
        ConversacionParticipante.objects.get_or_create(
            id_conversacion_id=conv.id_conversacion,
            id_usuario_id=solicitud.id_usuario_receptor_id,
            defaults={"rol": "ofreciente", "ultimo_visto_id_mensaje": 0, "silenciado": False, "archivado": False},
        )

        # 5) (ELIMINADO) No “reservamos” disponibilidad aquí

        # 6) Rechazar automáticamente otras PENDIENTES del mismo libro deseado
        (
            SolicitudIntercambio.objects.filter(
                id_libro_deseado_id=solicitud.id_libro_deseado_id,
                estado__iexact=SOLICITUD_ESTADO["PENDIENTE"],
            )
            .exclude(pk=solicitud.id_solicitud)
            .update(estado=SOLICITUD_ESTADO["RECHAZADA"], actualizada_en=timezone.now())
        )

    return Response(
        {"message": "Intercambio aceptado. Chat habilitado.", "intercambio_id": intercambio.id_intercambio},
        status=200,
    )

@api_view(["POST"])
@permission_classes([AllowAny])  # en prod: IsAuthenticated
def rechazar_solicitud(request, solicitud_id: int):
    # 1) Validar user_id
    try:
        user_id = int(request.data.get("user_id"))
    except (TypeError, ValueError):
        return Response({"detail": "user_id inválido."}, status=400)

    with transaction.atomic():
        # 2) Lock optimista: traer y validar
        solicitud = (
            SolicitudIntercambio.objects
            .select_for_update(skip_locked=True)
            .filter(pk=solicitud_id)
            .first()
        )
        if not solicitud:
            return Response({"detail": "La solicitud no existe."}, status=404)

        # 3) Permisos: solo el RECEPTOR puede rechazar
        if user_id != getattr(solicitud, "id_usuario_receptor_id", None):
            return Response({"detail": "Solo el receptor puede rechazar esta solicitud."}, status=403)

        # 4) Estado debe estar Pendiente
        if (solicitud.estado or "").lower() != SOLICITUD_ESTADO["PENDIENTE"].lower():
            return Response({"detail": "La solicitud ya fue respondida."}, status=409)

        # 5) Update atómico con guarda por estado
        updated = (
            SolicitudIntercambio.objects
            .filter(
                pk=solicitud_id,
                id_usuario_receptor_id=user_id,
                estado=SOLICITUD_ESTADO["PENDIENTE"],
            )
            .update(
                estado=SOLICITUD_ESTADO["RECHAZADA"],
                actualizada_en=timezone.now(),
            )
        )
        if not updated:
            # Otro proceso la cambió entre lectura y update
            return Response({"detail": "La solicitud ya fue respondida."}, status=409)

    return Response({
        "ok": True,
        "id_solicitud": solicitud_id,
        "estado": SOLICITUD_ESTADO["RECHAZADA"],
    }, status=200)

@api_view(["GET"])
@permission_classes([AllowAny])
def listar_solicitudes_recibidas(request):
    user_id = request.query_params.get("user_id")
    qs = (SolicitudIntercambio.objects
        .filter(id_usuario_receptor_id=user_id)
        .select_related('id_usuario_solicitante', 'id_usuario_receptor', 'id_libro_deseado', 'id_libro_ofrecido_aceptado')
        .prefetch_related('ofertas__id_libro_ofrecido', _inter_prefetch())
        .order_by('-creada_en'))
    return Response(SolicitudIntercambioSerializer(qs, many=True).data)

@api_view(["GET"])
@permission_classes([AllowAny])
def listar_solicitudes_enviadas(request):
    user_id = request.query_params.get("user_id")
    qs = (SolicitudIntercambio.objects
            .filter(id_usuario_solicitante_id=user_id)
            .select_related('id_usuario_solicitante', 'id_usuario_receptor', 'id_libro_deseado', 'id_libro_ofrecido_aceptado')
            .prefetch_related('ofertas__id_libro_ofrecido', _inter_prefetch())
            .order_by('-creada_en'))
    return Response(SolicitudIntercambioSerializer(qs, many=True).data)


# Helpers de rol según tu flujo:
# OFRECIENTE = quien recibe la solicitud (siempre es si.id_usuario_receptor)
# SOLICITANTE = quien envía la solicitud (si.id_usuario_solicitante)

def _roles(intercambio: Intercambio):
    si: SolicitudIntercambio = intercambio.id_solicitud
    return si.id_usuario_solicitante_id, si.id_usuario_receptor_id


@api_view(["PATCH"])
@permission_classes([AllowAny])
def proponer_encuentro(request, intercambio_id: int):
    with transaction.atomic():
        it = (Intercambio.objects
              .select_for_update()
              .select_related("id_solicitud")
              .filter(pk=intercambio_id).first())
        if not it:
            return Response({"detail": "Intercambio no encontrado"}, status=404)

        user_id = int(request.data.get("user_id") or 0)
        solicitante_id, ofreciente_id = _roles(it)
        if user_id != ofreciente_id:
            return Response({"detail": "Solo el ofreciente puede proponer lugar/fecha."}, status=403)

        if (it.estado_intercambio or "").lower() != INTERCAMBIO_ESTADO["ACEPTADO"].lower():
            return Response({"detail": "El intercambio debe estar en Aceptado."}, status=400)

        # === Compatibilidad: aceptar payload legacy {lugar, fecha} ===
        metodo = (request.data.get("metodo") or "").upper().strip()
        direccion = (request.data.get("direccion") or request.data.get("lugar") or "").strip()
        fecha_raw = (request.data.get("fecha") or request.data.get("fecha_intercambio") or "").strip()

        # Parse fecha (obligatoria)
        dt = parse_datetime(fecha_raw) if fecha_raw else None
        if not dt:
            return Response({"detail": "Fecha/hora inválida. Usa ISO 8601."}, status=400)
        if timezone.is_naive(dt):
            dt = timezone.make_aware(dt, timezone.get_current_timezone())
        if dt <= timezone.now() + timezone.timedelta(minutes=15):
            return Response({"detail": "La hora debe ser ≥ 15 min en el futuro."}, status=400)

        # Si no vino 'metodo', asumimos MANUAL (legacy)
        if not metodo:
            metodo = "MANUAL"

        punto = None
        lat = lon = None

        if metodo == "PREDEF":
            punto_id = request.data.get("punto_id")
            try:
                punto = PuntoEncuentro.objects.get(pk=int(punto_id), habilitado=True)
            except Exception:
                return Response({"detail": "punto_id inválido."}, status=400)
            direccion = direccion or (punto.direccion or punto.nombre)
            lat = punto.latitud
            lon = punto.longitud

        elif metodo == "MANUAL":
            # Ahora lat/lon son OPCIONALES (se guardan si vienen)
            lat_raw = request.data.get("lat")
            lon_raw = request.data.get("lon")
            try:
                lat = float(lat_raw) if lat_raw not in (None, "") else None
                lon = float(lon_raw) if lon_raw not in (None, "") else None
            except (TypeError, ValueError):
                return Response({"detail": "lat/lon inválidos."}, status=400)
            if not direccion:
                return Response({"detail": "Falta direccion."}, status=400)
        else:
            return Response({"detail": "metodo inválido (MANUAL|PREDEF)."}, status=400)

        # Solo 1 pendiente
        if PropuestaEncuentro.objects.filter(id_intercambio=it, estado="ACEPTADA").exists():
            return Response({"detail": "Ya existe una propuesta aceptada."}, status=409)
        if PropuestaEncuentro.objects.filter(id_intercambio=it, estado="PENDIENTE").exists():
            return Response({"detail": "Ya existe una propuesta pendiente."}, status=409)

        prop = PropuestaEncuentro.objects.create(
            id_intercambio=it,
            propuesta_por_id=user_id,
            metodo=metodo,
            id_punto=punto,
            latitud=lat,
            longitud=lon,
            direccion=direccion,
            fecha_hora=dt,
            notas=(request.data.get("notas") or "").strip()[:240],
            estado="PENDIENTE",
            activa=True,
        )

          # Notificar en el chat
        try:
            from .models import Conversacion, ConversacionMensaje
            conv = Conversacion.objects.filter(id_intercambio_id=it.id_intercambio).first()
            if conv:
                cuerpo = f"🗺️ Propuesta de encuentro: {direccion} — {dt.strftime('%Y-%m-%d %H:%M')}"
                m = ConversacionMensaje.objects.create(
                    id_conversacion=conv,
                    id_usuario_emisor_id=user_id,
                    cuerpo=cuerpo,
                    enviado_en=timezone.now()
                )
                Conversacion.objects.filter(pk=conv.id_conversacion).update(
                    actualizado_en=timezone.now(),
                    ultimo_id_mensaje=m.id_mensaje
                )
        except Exception:
            pass  # no bloquees el flujo si falla el aviso

        return Response({
            "ok": True,
            "propuesta_id": prop.id,
            "metodo": prop.metodo,
            "lugar": prop.direccion,
            "fecha": prop.fecha_hora,
            "estado": prop.estado,
        }, status=201)


@api_view(["PATCH"])
@permission_classes([AllowAny])
def confirmar_encuentro(request, intercambio_id: int):
    with transaction.atomic():
        it = (Intercambio.objects
              .select_for_update()
              .select_related("id_solicitud")
              .filter(pk=intercambio_id).first())
        if not it:
            return Response({"detail": "Intercambio no encontrado"}, status=404)

        user_id = int(request.data.get("user_id") or 0)
        solicitante_id, ofreciente_id = _roles(it)
        if user_id != solicitante_id:
            return Response({"detail": "Solo el solicitante puede confirmar."}, status=403)

        if (it.estado_intercambio or "").lower() != INTERCAMBIO_ESTADO["ACEPTADO"].lower():
            return Response({"detail": "El intercambio debe estar en Aceptado."}, status=400)

        ser = ConfirmarEncuentroSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        confirmar = bool(ser.validated_data["confirmar"])

        # Buscar la única PENDIENTE
        p = (PropuestaEncuentro.objects
             .select_for_update()
             .filter(id_intercambio=it, estado="PENDIENTE")
             .order_by('-id').first())
        if not p:
            return Response({"detail": "No hay propuesta pendiente."}, status=404)

        if confirmar:
            p.estado = "ACEPTADA"
            p.decidida_por_id = user_id
            p.decidida_en = timezone.now()
            p.activa = False
            p.save(update_fields=["estado","decidida_por","decidida_en","activa"])

            # ⬇️ NUEVO: reflejar reunión en Intercambio + Solicitud
            it.lugar_intercambio = p.direccion
            it.fecha_intercambio_pactada = p.fecha_hora
            it.save(update_fields=["lugar_intercambio", "fecha_intercambio_pactada"])

            si = it.id_solicitud
            si.lugar_intercambio = p.direccion
            si.fecha_intercambio_pactada = p.fecha_hora
            si.save(update_fields=["lugar_intercambio", "fecha_intercambio_pactada"])

            return Response(
                {"ok": True, "coordinado": True, "lugar": p.direccion, "fecha": p.fecha_hora},
                status=200
    )
        else:
            # Rechazar -> permite nuevas propuestas
            p.estado = "RECHAZADA"
            p.decidida_por_id = user_id
            p.decidida_en = timezone.now()
            p.activa = False
            # opcional: anexar motivo si mandas "notas"
            notas = (request.data.get("notas") or "").strip()
            if notas:
                p.notas = (p.notas or "") + f"\n[RECHAZO] {notas}"[:240]
            p.save(update_fields=["estado","decidida_por","decidida_en","activa","notas"])
            return Response({"ok": True, "coordinado": False}, status=200)


@api_view(["POST"])
@permission_classes([AllowAny])
def generar_codigo(request, intercambio_id: int):
    it = (Intercambio.objects
          .select_related("id_solicitud")
          .filter(pk=intercambio_id).first())
    if not it:
        return Response({"detail": "Intercambio no encontrado"}, status=404)

    user_id = int(request.data.get("user_id") or 0)
    solicitante_id, ofreciente_id = _roles(it)
    if user_id != ofreciente_id:
        return Response({"detail": "Solo el ofreciente puede generar el código."}, status=403)

    if (it.estado_intercambio or "").lower() != INTERCAMBIO_ESTADO["ACEPTADO"].lower():
        return Response({"detail": "El intercambio debe estar en Aceptado."}, status=400)

    # 🔒 Nuevo: exigir propuesta aceptada
    if not PropuestaEncuentro.objects.filter(id_intercambio=it, estado="ACEPTADA").exists():
        return Response({"detail": "Debes aceptar una propuesta de encuentro antes de generar el código."}, status=409)

    ser = GenerarCodigoSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    raw = (ser.validated_data.get("codigo") or "").strip()
    if not raw:
        raw = get_random_string(6, allowed_chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789")

    expira = timezone.now() + timezone.timedelta(days=30)
    obj, _ = IntercambioCodigo.objects.update_or_create(
        id_intercambio=it,
        defaults={"codigo": raw, "expira_en": expira, "usado_en": None}
    )
    return Response({"ok": True, "codigo": raw, "expira_en": expira})


@api_view(["POST"])
@permission_classes([AllowAny])
def completar_intercambio(request, intercambio_id: int):
    it = (Intercambio.objects
          .select_related("id_solicitud")
          .filter(pk=intercambio_id).first())
    if not it:
        return Response({"detail": "Intercambio no encontrado"}, status=404)

    if (it.estado_intercambio or "").lower() != "aceptado":
        return Response({"detail": "El intercambio debe estar en Aceptado."}, status=400)

    try:
        ser = CompletarConCodigoSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
    except drf_serializers.ValidationError as exc:
        # aplana errores por campo a un solo 'detail' legible
        flat = "; ".join([f"{k}: {', '.join(map(str, v))}" for k, v in exc.detail.items()])
        return Response({"detail": flat or "Datos inválidos."}, status=400)

    user_id = ser.validated_data["user_id"]
    solicitante_id, _ = _roles(it)
    if user_id != solicitante_id:
        return Response({"detail": "Solo el solicitante puede completar ingresando el código."}, status=403)

    codigo_ingresado = (ser.validated_data["codigo"] or "").strip().upper()
    fecha = ser.validated_data.get("fecha")  # opcional

    ctrl = IntercambioCodigo.objects.filter(id_intercambio=it).first()
    if not ctrl or not ctrl.codigo:
        return Response({"detail": "Aún no hay código generado."}, status=400)
    if ctrl.usado_en:
        return Response({"detail": "Este código ya fue utilizado."}, status=400)
    if ctrl.expira_en and ctrl.expira_en < timezone.now():
        return Response({"detail": "El código expiró."}, status=400)

    if (ctrl.codigo or "").strip().upper() != codigo_ingresado:
        return Response({"detail": "Código inválido."}, status=400)

    ctrl.usado_en = timezone.now()
    ctrl.save(update_fields=["usado_en"])

    try:
        with connection.cursor() as cur:
            cur.callproc("sp_marcar_intercambio_completado", [intercambio_id, fecha])

        # 🔥 NUEVO: limpiar favoritos de ambos libros involucrados
        try:
            booked_ids = [
                it.id_libro_ofrecido_aceptado_id,
                getattr(it.id_solicitud, "id_libro_deseado_id", None),
            ]
            Favorito.objects.filter(id_libro_id__in=[x for x in booked_ids if x]).delete()
        except Exception:
            # no bloquear el flujo por limpieza de favoritos
            pass

        return Response({"ok": True})

    except Exception as e:
        # rollback del uso del código si el SP falló
        ctrl.usado_en = None
        ctrl.save(update_fields=["usado_en"])
        return Response({"detail": str(e)}, status=400)










@api_view(["POST"])
@permission_classes([AllowAny])
def cancelar_solicitud(request, solicitud_id):
    user_id = int(request.data.get("user_id") or 0)
    try:
        s = SolicitudIntercambio.objects.select_related("id_usuario_solicitante").get(pk=solicitud_id)
    except SolicitudIntercambio.DoesNotExist:
        return Response({"detail": "Solicitud no encontrada."}, status=404)

    if s.id_usuario_solicitante_id != user_id:
        return Response({"detail": "Solo el solicitante puede cancelar la solicitud."}, status=403)

    if (s.estado or "").lower() != SOLICITUD_ESTADO["PENDIENTE"].lower():
        return Response({"detail": "Solo se puede cancelar una solicitud pendiente."}, status=400)

    s.estado = SOLICITUD_ESTADO["CANCELADA"]
    s.save(update_fields=["estado"])
    return Response({"ok": True, "estado": s.estado})

@api_view(["POST"])
@permission_classes([AllowAny])
def cancelar_intercambio(request, intercambio_id: int):
    user_id = int(request.data.get("user_id") or 0)
    it = (Intercambio.objects
          .select_related("id_solicitud")
          .filter(pk=intercambio_id).first())
    if not it:
        return Response({"detail": "Intercambio no encontrado"}, status=404)

    solicitante_id, ofreciente_id = _roles(it)
    if user_id not in (solicitante_id, ofreciente_id):
        return Response({"detail": "No autorizado para cancelar este intercambio."}, status=403)

    if (it.estado_intercambio or "").lower() != INTERCAMBIO_ESTADO["ACEPTADO"].lower():
        return Response({"detail": "Solo se pueden cancelar intercambios aceptados."}, status=400)

    with transaction.atomic():
        it.estado_intercambio = INTERCAMBIO_ESTADO["CANCELADO"]
        it.save(update_fields=["estado_intercambio"])
        # refleja cancelación también en la solicitud
        si = it.id_solicitud
        si.estado = SOLICITUD_ESTADO["CANCELADA"]
        si.save(update_fields=["estado"])

    return Response({"ok": True, "estado_intercambio": it.estado_intercambio, "estado_solicitud": it.id_solicitud.estado})


@api_view(["GET"])
@permission_classes([AllowAny])
def mi_calificacion(request, intercambio_id: int):
    user_id = int(request.query_params.get("user_id") or 0)
    from .models import Calificacion
    row = Calificacion.objects.filter(
        id_intercambio_id=intercambio_id,
        id_usuario_calificador_id=user_id
    ).values("puntuacion", "comentario").first()
    return Response(row or {})


# ========= FAVORITOS =========

@api_view(["GET"])
@permission_classes([AllowAny])
def favoritos_list(request):
    """
    GET /api/favoritos/?user_id=123
    Devuelve libros marcados como favoritos por el usuario.
    """
    user_id = request.query_params.get("user_id")
    if not user_id:
        return Response({"detail": "Falta user_id"}, status=400)

    # portada o primera imagen
    portada_sq = (ImagenLibro.objects
        .filter(id_libro=OuterRef("pk"), is_portada=True)
        .order_by("id_imagen").values_list("url_imagen", flat=True)[:1])
    first_by_order_sq = (ImagenLibro.objects
        .filter(id_libro=OuterRef("pk"))
        .order_by("orden", "id_imagen").values_list("url_imagen", flat=True)[:1])

    qs = (Libro.objects
          .filter(id_libro__in=Favorito.objects
                  .filter(id_usuario_id=user_id)
                  .values_list("id_libro_id", flat=True)))
    qs = (qs
          .select_related("id_usuario")
          .annotate(first_image=Coalesce(Subquery(portada_sq), Subquery(first_by_order_sq)))
          .order_by("-fecha_subida", "-id_libro"))

    data = []
    for b in qs:
        rel = (b.first_image or "").replace("\\", "/")
        data.append({
            "id": b.id_libro,
            "titulo": b.titulo,
            "autor": b.autor,
            "estado": b.estado,
            "disponible": bool(b.disponible),
            "fecha_subida": b.fecha_subida,
            "first_image": media_abs(request, rel) if rel else None,
            "owner_nombre": getattr(b.id_usuario, "nombre_usuario", None),
            "owner_id": getattr(b.id_usuario, "id_usuario", None),
        })
    return Response(data)


@api_view(["GET"])
@permission_classes([AllowAny])
def favoritos_check(request, libro_id: int):
    """
    GET /api/favoritos/<libro_id>/check?user_id=123
    """
    user_id = request.query_params.get("user_id")
    if not user_id:
        return Response({"favorited": False})
    exists = Favorito.objects.filter(id_usuario_id=user_id, id_libro_id=libro_id).exists()
    return Response({"favorited": bool(exists)})


@api_view(["POST"])
@permission_classes([AllowAny])
def favoritos_toggle(request, libro_id: int):
    """
    POST /api/favoritos/<libro_id>/toggle?user_id=123
    Reglas:
      - no puedes marcar tus propios libros
      - solo libros disponibles
      - toggle on/off
    """
    user_id = request.query_params.get("user_id") or request.data.get("user_id")
    if not user_id:
        return Response({"detail": "Falta user_id"}, status=400)

    # ¿existe ya?
    obj = Favorito.objects.filter(id_usuario_id=user_id, id_libro_id=libro_id).first()
    if obj:
        obj.delete()
        return Response({"favorited": False})

    # validar libro
    b = Libro.objects.filter(pk=libro_id).only("id_libro", "id_usuario_id", "disponible").first()
    if not b:
        return Response({"detail": "Libro no encontrado."}, status=404)
    if int(b.id_usuario_id) == int(user_id):
        return Response({"detail": "No puedes marcar como favorito tu propio libro."}, status=400)
    if not bool(b.disponible):
        return Response({"detail": "El libro no está disponible."}, status=409)

    # crear (si metes el índice UNIQUE, evita duplicados de carrera)
    try:
        Favorito.objects.get_or_create(id_usuario_id=user_id, id_libro_id=libro_id)
        return Response({"favorited": True}, status=201)
    except Exception as e:
        return Response({"detail": str(e)}, status=400)
    

@api_view(["GET"])
@permission_classes([AllowAny])
def puntos_encuentro(request):
    qs = PuntoEncuentro.objects.all()
    tipo = (request.query_params.get("tipo") or "").upper().strip()
    if tipo:
        qs = qs.filter(tipo=tipo)

    hab = request.query_params.get("habilitado")
    if hab is None:
        qs = qs.filter(habilitado=True)  # default
    else:
        val = str(hab).lower() in ("1","true","t","yes","y","on")
        qs = qs.filter(habilitado=val)

    return Response(PuntoEncuentroSerializer(qs, many=True).data)






@api_view(["GET"])
@permission_classes([AllowAny])
def propuesta_actual(request, intercambio_id: int):
    """
    Devuelve la propuesta ACTIVA (PENDIENTE) si existe.
    Si no hay activa, devuelve la última propuesta (ACEPTADA o RECHAZADA) para mostrar contexto.
    """
    from .models import PropuestaEncuentro

    q = PropuestaEncuentro.objects.filter(id_intercambio_id=intercambio_id)

    p = q.filter(activa=True).order_by('-id').first()
    if not p:
        p = q.order_by('-id').first()

    if not p:
        return Response({})

    return Response({
        "id": p.pk,
        "estado": p.estado,                # PENDIENTE / ACEPTADA / RECHAZADA
        "metodo": p.metodo,                # MANUAL / PREDEF
        "direccion": p.direccion,
        "lat": p.latitud,
        "lon": p.longitud,
        "fecha": p.fecha_hora,
        "propuesta_por_id": p.propuesta_por_id,
        "activa": p.activa,
    })


