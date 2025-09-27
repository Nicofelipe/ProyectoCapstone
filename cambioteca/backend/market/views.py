from collections import defaultdict
import os
import uuid

from django.db import connection 
from django.conf import settings
from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models import (
    Q, F, Value, Count, IntegerField,
    Exists, Subquery, OuterRef, Max, Avg
)
from django.db.models.functions import Coalesce, Greatest
from django.utils import timezone

from rest_framework import permissions, viewsets, status
from rest_framework.decorators import action, api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Libro, Intercambio, ImagenLibro, LibroSolicitudesVistas
from .serializers import LibroSerializer

# =========================
# Helpers
# =========================
def media_abs(request, rel: str | None = None) -> str:
    rel = (rel or "books/librodefecto.png").lstrip("/")
    media_prefix = (settings.MEDIA_URL or "/media/").strip("/")
    path = f"/{media_prefix}/{rel}".replace("//", "/")
    return request.build_absolute_uri(path)

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
class LibroViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = LibroSerializer
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        # Trae el dueño en la misma query
        qs = (Libro.objects
              .select_related('id_usuario')
              .all()
              .order_by('-id_libro'))
        q = self.request.query_params.get('query')
        if q:
            qs = qs.filter(
                Q(titulo__icontains=q) |
                Q(autor__icontains=q) |
                Q(genero__icontains=q)
            )
        return qs

    @action(detail=False, methods=['get'])
    def latest(self, request):
        qs = (
            Libro.objects
            .filter(disponible=True)
            .order_by('-fecha_subida', '-id_libro')[:10]
        )
        data = LibroSerializer(qs, many=True).data
        return Response(data)

    @action(detail=False, methods=['get'])
    def populares(self, request):
        agregados = (
            Libro.objects
            .annotate(
                comp_ofrecido=Count(
                    'intercambios_donde_fue_ofrecido',
                    filter=Q(intercambios_donde_fue_ofrecido__estado_intercambio='Completado')
                ),
                comp_solicitado=Count(
                    'intercambios_donde_fue_solicitado',
                    filter=Q(intercambios_donde_fue_solicitado__estado_intercambio='Completado')
                ),
            )
            .values('titulo')
            .annotate(
                total_intercambios=Coalesce(
                    F('comp_ofrecido') + F('comp_solicitado'),
                    Value(0), output_field=IntegerField()
                ),
                repeticiones=Count('titulo'),
            )
            .order_by('-total_intercambios', '-repeticiones', 'titulo')[:10]
        )
        result = [
            {
                "titulo": row['titulo'],
                "total_intercambios": row['total_intercambios'],
                "repeticiones": row['repeticiones'],
            }
            for row in agregados
        ]
        return Response(result)

# =========================
# Crear libro
# =========================
@api_view(["POST"])
@permission_classes([AllowAny])
def create_book(request):
    data = request.data
    required = [
        "titulo", "isbn", "anio_publicacion", "autor", "estado",
        "descripcion", "editorial", "genero", "tipo_tapa", "id_usuario"
    ]
    missing = [k for k in required if not data.get(k)]
    if missing:
        return Response({"detail": f"Faltan: {', '.join(missing)}"}, status=400)

    try:
        libro = Libro.objects.create(
            titulo=data["titulo"],
            isbn=str(data["isbn"]),
            anio_publicacion=int(data["anio_publicacion"]),
            autor=data["autor"],
            estado=data["estado"],
            descripcion=data["descripcion"],
            editorial=data["editorial"],
            genero=data["genero"],
            tipo_tapa=data["tipo_tapa"],
            id_usuario_id=int(data["id_usuario"]),
            disponible=bool(data.get("disponible", True)),
        )
        return Response({"id": libro.id_libro}, status=201)
    except Exception as e:
        return Response({"detail": f"No se pudo crear: {e}"}, status=400)

# =========================
# Subida y gestión de imágenes
# =========================
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

    # 🔁 Preferir portada; si no hay, usar primera por orden
    portada_sq = (ImagenLibro.objects
                  .filter(id_libro=OuterRef("pk"), is_portada=True)
                  .order_by("id_imagen")
                  .values_list("url_imagen", flat=True)[:1])

    first_by_order_sq = (ImagenLibro.objects
                         .filter(id_libro=OuterRef("pk"))
                         .order_by("orden", "id_imagen")
                         .values_list("url_imagen", flat=True)[:1])

    has_req = Exists(
        Intercambio.objects.filter(
            Q(id_libro_ofrecido=OuterRef("pk")) | Q(id_libro_solicitado=OuterRef("pk"))
        )
    )

    max_off = Max('intercambios_donde_fue_ofrecido__id_intercambio')
    max_sol = Max('intercambios_donde_fue_solicitado__id_intercambio')

    seen_sq = (LibroSolicitudesVistas.objects
               .filter(id_usuario_id=user_id, id_libro=OuterRef("pk"))
               .values("ultimo_visto_id_intercambio")[:1])

    qs = (Libro.objects
          .filter(id_usuario_id=user_id)
          .annotate(first_image=Coalesce(Subquery(portada_sq), Subquery(first_by_order_sq)))
          .annotate(has_requests=has_req)
          .annotate(max_inter_id=Coalesce(Greatest(max_off, max_sol), Value(0)))
          .annotate(last_seen=Coalesce(Subquery(seen_sq), Value(0)))
          .order_by("-fecha_subida", "-id_libro"))

    from core.models import Usuario
    u = Usuario.objects.filter(pk=user_id).select_related("comuna").first()
    comuna_nombre = getattr(getattr(u, "comuna", None), "nombre", None)

    data = []
    for b in qs:
        img_rel = (b.first_image or "").replace("\\", "/")
        first_image_url = media_abs(request, img_rel)
        has_new = int(getattr(b, "max_inter_id", 0) or 0) > int(getattr(b, "last_seen", 0) or 0)

        data.append({
            "id": b.id_libro,
            "titulo": b.titulo,
            "autor": b.autor,
            "estado": b.estado,
            "descripcion": b.descripcion,
            "editorial": b.editorial,
            "genero": b.genero,
            "tipo_tapa": b.tipo_tapa,
            "disponible": bool(b.disponible),
            "fecha_subida": b.fecha_subida,
            "first_image": first_image_url,
            "has_requests": bool(b.has_requests),
            "has_new_requests": bool(has_new),
            "comuna_nombre": comuna_nombre,
        })
    return Response(data)

@api_view(["GET"])
@permission_classes([AllowAny])
def my_books_with_history(request):
    user_id = request.query_params.get("user_id")
    if not user_id:
        return Response({"detail": "Falta user_id"}, status=400)

    try:
        limit = int(request.query_params.get("limit", 10)) or 10
    except Exception:
        limit = 10

    portada_sq = (ImagenLibro.objects
                  .filter(id_libro=OuterRef("pk"), is_portada=True)
                  .order_by("id_imagen")
                  .values_list("url_imagen", flat=True)[:1])

    first_by_order_sq = (ImagenLibro.objects
                         .filter(id_libro=OuterRef("pk"))
                         .order_by("orden", "id_imagen")
                         .values_list("url_imagen", flat=True)[:1])

    has_req = Exists(
        Intercambio.objects.filter(
            Q(id_libro_ofrecido=OuterRef("pk")) | Q(id_libro_solicitado=OuterRef("pk"))
        )
    )

    max_off = Max('intercambios_donde_fue_ofrecido__id_intercambio')
    max_sol = Max('intercambios_donde_fue_solicitado__id_intercambio')
    seen_sq = (LibroSolicitudesVistas.objects
               .filter(id_usuario_id=user_id, id_libro=OuterRef("pk"))
               .values("ultimo_visto_id_intercambio")[:1])

    books_qs = (Libro.objects
                .filter(id_usuario_id=user_id)
                .annotate(first_image=Coalesce(Subquery(portada_sq), Subquery(first_by_order_sq)))
                .annotate(has_requests=has_req)
                .annotate(max_inter_id=Coalesce(Greatest(max_off, max_sol), Value(0)))
                .annotate(last_seen=Coalesce(Subquery(seen_sq), Value(0)))
                .order_by("-fecha_subida", "-id_libro"))

    from core.models import Usuario
    u = Usuario.objects.filter(pk=user_id).select_related("comuna").first()
    comuna_nombre = getattr(getattr(u, "comuna", None), "nombre", None)

    book_ids = list(books_qs.values_list("id_libro", flat=True))
    if not book_ids:
        return Response([])

    inter_qs = (Intercambio.objects
                .filter(Q(id_libro_ofrecido_id__in=book_ids) | Q(id_libro_solicitado_id__in=book_ids))
                .select_related(
                    "id_usuario_solicitante", "id_usuario_ofreciente",
                    "id_libro_solicitado", "id_libro_ofrecido"
                )
                .order_by("-id_intercambio"))

    history_by_book = defaultdict(list)
    counters_by_book = {bid: {"total":0,"completados":0,"pendientes":0,"aceptados":0,"rechazados":0} for bid in book_ids}

    for it in inter_qs:
        if it.id_libro_ofrecido_id in counters_by_book:
            key_id = it.id_libro_ofrecido_id; rol = "ofrecido"
            counterpart_user = getattr(it.id_usuario_solicitante, "nombre_usuario", None)
            counterpart_user_id = getattr(it.id_usuario_solicitante, "id_usuario", None)
            counterpart_book = getattr(it.id_libro_solicitado, "titulo", None)
            counterpart_book_id = getattr(it.id_libro_solicitado, "id_libro", None)
        elif it.id_libro_solicitado_id in counters_by_book:
            key_id = it.id_libro_solicitado_id; rol = "solicitado"
            counterpart_user = getattr(it.id_usuario_ofreciente, "nombre_usuario", None)
            counterpart_user_id = getattr(it.id_usuario_ofreciente, "id_usuario", None)
            counterpart_book = getattr(it.id_libro_ofrecido, "titulo", None)
            counterpart_book_id = getattr(it.id_libro_ofrecido, "id_libro", None)
        else:
            continue

        ctr = counters_by_book[key_id]
        ctr["total"] += 1
        est = (it.estado_intercambio or "").lower()
        if est == "completado": ctr["completados"] += 1
        elif est == "pendiente": ctr["pendientes"] += 1
        elif est == "aceptado": ctr["aceptados"] += 1
        elif est == "rechazado": ctr["rechazados"] += 1

        history_by_book[key_id].append({
            "id": it.id_intercambio,
            "estado": it.estado_intercambio,
            "fecha": it.fecha_intercambio or it.fecha_completado,
            "rol": rol,
            "counterpart_user_id": counterpart_user_id,
            "counterpart_user": counterpart_user,
            "counterpart_book_id": counterpart_book_id,
            "counterpart_book": counterpart_book,
        })

    if limit:
        for bid in list(history_by_book.keys()):
            history_by_book[bid] = history_by_book[bid][:limit]

    data = []
    for b in books_qs:
        img_rel = (b.first_image or "").replace("\\", "/")
        first_image_url = media_abs(request, img_rel)
        has_new = int(getattr(b, "max_inter_id", 0) or 0) > int(getattr(b, "last_seen", 0) or 0)

        data.append({
            "id": b.id_libro,
            "titulo": b.titulo,
            "autor": b.autor,
            "estado": b.estado,
            "descripcion": b.descripcion,
            "editorial": b.editorial,
            "genero": b.genero,
            "tipo_tapa": b.tipo_tapa,
            "disponible": bool(b.disponible),
            "fecha_subida": b.fecha_subida,
            "first_image": first_image_url,
            "has_requests": bool(b.has_requests),
            "has_new_requests": bool(has_new),
            "comuna_nombre": comuna_nombre,
            "counters": counters_by_book.get(b.id_libro, {"total":0,"completados":0,"pendientes":0,"aceptados":0,"rechazados":0}),
            "history": history_by_book.get(b.id_libro, []),
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

    max_id = (Intercambio.objects
              .filter(Q(id_libro_ofrecido_id=libro_id) | Q(id_libro_solicitado_id=libro_id))
              .aggregate(m=Max("id_intercambio"))["m"] or 0)

    obj, _ = LibroSolicitudesVistas.objects.update_or_create(
        id_usuario_id=user_id, id_libro_id=libro_id,
        defaults={
            "ultimo_visto_id_intercambio": int(max_id),
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

    allowed = {
        "titulo", "autor", "isbn", "anio_publicacion", "estado",
        "descripcion", "editorial", "genero", "tipo_tapa", "disponible"
    }
    changed = []
    data = request.data

    for field in allowed:
        if field in data:
            val = data.get(field)
            if field == "anio_publicacion" and val not in (None, ""):
                try:
                    val = int(val)
                except Exception:
                    return Response({"detail": "anio_publicacion inválido."}, status=400)
            setattr(libro, field, val)
            changed.append(field)

    if changed:
        libro.save(update_fields=changed)

    return Response({
        "id": libro.id_libro,
        "titulo": libro.titulo,
        "autor": libro.autor,
        "isbn": libro.isbn,
        "anio_publicacion": libro.anio_publicacion,
        "estado": libro.estado,
        "descripcion": libro.descripcion,
        "editorial": libro.editorial,
        "genero": libro.genero,
        "tipo_tapa": libro.tipo_tapa,
        "disponible": libro.disponible,
        "fecha_subida": libro.fecha_subida,
    }, status=status.HTTP_200_OK)

@api_view(["DELETE"])
@permission_classes([AllowAny])
def delete_book(request, libro_id: int):
    libro = Libro.objects.filter(pk=libro_id).first()
    if not libro:
        return Response({"detail": "Libro no encontrado."}, status=404)

    if Intercambio.objects.filter(
        Q(id_libro_ofrecido_id=libro_id) | Q(id_libro_solicitado_id=libro_id)
    ).exists():
        return Response(
            {"detail": "No se puede eliminar: el libro participa en intercambios."},
            status=400
        )

    for im in ImagenLibro.objects.filter(id_libro_id=libro_id):
        rel = (im.url_imagen or '').replace('\\', '/')
        im.delete()
        try:
            if rel:
                default_storage.delete(rel)
        except Exception:
            pass

    libro.delete()
    return Response(status=204)


# =========================
# Intercambios (solicitudes)
# =========================
@api_view(["POST"])
@permission_classes([AllowAny])  # cambia a IsAuthenticated en prod
def crear_intercambio(request):
    """
    Crea una solicitud de intercambio (estado = Pendiente).

    Body JSON:
    {
      "id_usuario_solicitante": 1,
      "id_libro_ofrecido": 101,
      "id_usuario_ofreciente": 2,
      "id_libro_solicitado": 104,
      "lugar_intercambio": "Metro Baquedano",
      "fecha_intercambio": "2025-09-30"  # opcional (YYYY-MM-DD)
    }
    """
    data = request.data
    required = [
        "id_usuario_solicitante", "id_libro_ofrecido",
        "id_usuario_ofreciente",  "id_libro_solicitado",
        "lugar_intercambio"
    ]
    miss = [k for k in required if not data.get(k)]
    if miss:
        return Response({"detail": f"Faltan: {', '.join(miss)}"}, status=400)

    try:
        obj = Intercambio.objects.create(
            id_usuario_solicitante_id = int(data["id_usuario_solicitante"]),
            id_usuario_ofreciente_id  = int(data["id_usuario_ofreciente"]),
            id_libro_ofrecido_id      = int(data["id_libro_ofrecido"]),
            id_libro_solicitado_id    = int(data["id_libro_solicitado"]),
            lugar_intercambio         = data["lugar_intercambio"],
            fecha_intercambio         = data.get("fecha_intercambio") or None,
            estado_intercambio        = "Pendiente",
        )
        return Response({"id_intercambio": obj.id_intercambio}, status=201)
    except Exception as e:
        # Tus triggers en MySQL devuelven mensajes claros si algo no cuadra
        return Response({"detail": str(e)}, status=400)


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


@api_view(["POST"])
@permission_classes([AllowAny])  # cambia a IsAuthenticated en prod
def completar_intercambio(request, intercambio_id: int):
    """
    Marca un intercambio como Completado usando tu SP para respetar reglas.
    Body JSON opcional: { "fecha": "YYYY-MM-DD" }
    """
    fecha = request.data.get("fecha")
    try:
        with connection.cursor() as cur:
            cur.callproc("sp_marcar_intercambio_completado", [intercambio_id, fecha])
        return Response({"ok": True})
    except Exception as e:
        return Response({"detail": str(e)}, status=400)
    
@api_view(["GET"])
@permission_classes([AllowAny])
def solicitudes_entrantes(request):
    """
    QueryString: ?user_id=123
    Devuelve solicitudes 'Pendiente' que afectan libros del usuario (como ofreciente).
    """
    user_id = request.query_params.get("user_id")
    if not user_id:
        return Response({"detail": "Falta user_id"}, status=400)

    qs = (Intercambio.objects
          .filter(id_usuario_ofreciente_id=user_id, estado_intercambio="Pendiente")
          .select_related("id_usuario_solicitante", "id_libro_solicitado", "id_libro_ofrecido")
          .order_by("-id_intercambio"))
    data = [{
        "id": it.id_intercambio,
        "solicitante": getattr(it.id_usuario_solicitante, "nombre_usuario", None),
        "libro_mio": getattr(it.id_libro_solicitado, "titulo", None),
        "libro_del_otro": getattr(it.id_libro_ofrecido, "titulo", None),
        "lugar": it.lugar_intercambio,
        "fecha": it.fecha_intercambio,
        "estado": it.estado_intercambio,
    } for it in qs]
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
                  .order_by("id_imagen")
                  .values("url_imagen")[:1])
    first_by_order_sq = (ImagenLibro.objects
                         .filter(id_libro=OuterRef("pk"))
                         .order_by("orden", "id_imagen")
                         .values("url_imagen")[:1])

    # Reputación del dueño (promedio y cantidad)
    from .models import Clasificacion
    avg_sq = (Clasificacion.objects
              .filter(id_usuario_calificado=OuterRef("id_usuario_id"))
              .values("id_usuario_calificado")
              .annotate(a=Avg("puntuacion"))
              .values("a")[:1])
    cnt_sq = (Clasificacion.objects
              .filter(id_usuario_calificado=OuterRef("id_usuario_id"))
              .values("id_usuario_calificado")
              .annotate(c=Count("id_clasificacion"))
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
            "owner": {
                "id": getattr(b.id_usuario, "id_usuario", None),
                "nombre_usuario": getattr(b.id_usuario, "nombre_usuario", None),
                "rating_avg": float(b.owner_rating_avg) if b.owner_rating_avg is not None else None,
                "rating_count": int(b.owner_rating_count or 0),
            }
        })
    return Response(data)
