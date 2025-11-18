# core/views.py
from django.conf import settings
from django.utils import timezone
from datetime import timedelta
from django.core.files.storage import default_storage
from django.core.mail import EmailMultiAlternatives, send_mail
from email.mime.image import MIMEImage
from django.contrib.auth.hashers import check_password, make_password
from django.db.models import Q, Avg, Count, F
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser

from .permissions import IsAdminUser as IsCambiotecaAdmin  # <- tu permiso custom
from .models import PasswordResetToken, Usuario, Region, Comuna
from .serializers import (
    RegisterSerializer, RegionSerializer, ComunaSerializer,
    ForgotPasswordSerializer, ResetPasswordSerializer,
    UsuarioLiteSerializer, UsuarioSummarySerializer
)
from django.db.models.functions import Coalesce, TruncDay, TruncMonth
from collections import defaultdict
from django.db.models import (
 OuterRef, Subquery, IntegerField, Value
)
from market.models import (
    Libro,
    Intercambio,
    Calificacion,
    SolicitudIntercambio,
    Genero,
)


from market.models import Libro, Intercambio, Calificacion

import jwt
import datetime
import os
import uuid
import secrets

# =========================
# Helpers
# =========================
def _abs_media_url(request, rel_path: str) -> str:
    """
    Si rel_path está en MEDIA (p.ej. 'avatars/xx.jpg'), devuelve URL absoluta.
    Si ya viene absoluta, la retorna tal cual.
    """
    if not rel_path:
        rel_path = ''
    if str(rel_path).startswith(('http://', 'https://')):
        return str(rel_path)
    media_prefix = settings.MEDIA_URL.lstrip('/')
    path_clean = str(rel_path).lstrip('/')
    if path_clean.startswith(media_prefix):
        url_path = '/' + path_clean
    else:
        url_path = '/' + media_prefix + path_clean
    return request.build_absolute_uri(url_path)

def _save_avatar(file_obj) -> str:
    """
    Guarda el archivo en MEDIA_ROOT/avatars/<uuid>.<ext> y devuelve la ruta relativa.
    """
    try:
        file_obj.seek(0)
    except Exception:
        pass

    original = getattr(file_obj, "name", "avatar")
    ext = os.path.splitext(original)[1].lower() or ".jpg"
    rel_path = f"avatars/{uuid.uuid4().hex}{ext}"

    try:
        base_str = str(settings.MEDIA_ROOT)
        os.makedirs(os.path.join(base_str, "avatars"), exist_ok=True)
    except Exception:
        pass

    saved_rel = default_storage.save(rel_path, file_obj)
    return str(saved_rel).replace("\\", "/")

# =========================
# LOGIN HS256 (opcional / no recomendado si ya usas SimpleJWT en views_auth.py)
# =========================
@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    """
    Si ya usas /core/auth/login/ (SimpleJWT) NO publiques este endpoint en urls.
    Lo dejo por compatibilidad, pero idealmente deshabilitar.
    """
    email = (request.data.get("email") or "").strip()
    contrasena = request.data.get("contrasena") or ""

    if not email or not contrasena:
        return Response({"error": "Email y contraseña son obligatorios."}, status=400)

    user = Usuario.objects.filter(email__iexact=email, activo=True).first()
    if not user:
        return Response({"error": "Usuario no encontrado o inactivo."}, status=401)

    ok = False
    try:
        ok = check_password(contrasena, user.contrasena)
    except Exception:
        ok = False
    if not ok and user.contrasena == contrasena:
        ok = True

    if not ok:
        return Response({"error": "Contraseña incorrecta."}, status=401)

    exp_dt = timezone.now() + datetime.timedelta(hours=24)
    payload = {
        "id": user.id_usuario,
        "email": user.email,
        "exp": int(exp_dt.timestamp()),
        "iat": int(timezone.now().timestamp()),
    }
    token = jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")

    default_rel = "avatars/avatardefecto.jpg"
    pic_rel = user.imagen_perfil or default_rel
    avatar_url = _abs_media_url(request, pic_rel)

    return Response({
        "access": token,
        "user": {
            "id": user.id_usuario,
            "email": user.email,
            "nombres": user.nombres,
            "apellido_paterno": user.apellido_paterno,
            "nombre_usuario": user.nombre_usuario,
            "imagen_perfil": user.imagen_perfil,
            "avatar_url": avatar_url,
            "verificado": user.verificado,
            "es_admin": bool(user.es_admin),
        }
    })

# =========================
# REGISTER (archivo o URL)
# =========================
@api_view(["POST"])
@permission_classes([AllowAny])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def register_usuario(request):
    data = request.data.copy()

    avatar_file = request.FILES.get("imagen_perfil")
    if avatar_file:
        try:
            data["imagen_perfil"] = _save_avatar(avatar_file)
        except Exception as e:
            return Response({"error": f"No se pudo guardar la imagen: {e}"}, status=400)
    else:
        imagen_url = data.get("imagen_url")
        if imagen_url:
            data["imagen_perfil"] = imagen_url

    ser = RegisterSerializer(data=data)
    if ser.is_valid():
        user = ser.save()
        return Response({"message": "Usuario creado", "id": user.id_usuario}, status=201)
    return Response(ser.errors, status=400)

# =========================
# CATÁLOGO (regiones / comunas)
# =========================
@api_view(["GET"])
@permission_classes([AllowAny])
def regiones_view(request):
    qs = Region.objects.all().order_by("nombre")
    return Response(RegionSerializer(qs, many=True).data)

@api_view(["GET"])
@permission_classes([AllowAny])
def comunas_view(request):
    region_id = request.query_params.get("region")
    qs = Comuna.objects.all().order_by("nombre")
    if region_id:
        qs = qs.filter(id_region_id=region_id)
    return Response(ComunaSerializer(qs, many=True).data)

# =========================
# Forgot / Reset password
# =========================
FRONTEND_RESET_URL = getattr(settings, 'FRONTEND_RESET_URL', 'http://localhost:8100/auth/reset-password')

@api_view(["POST"])
@permission_classes([AllowAny])
def forgot_password(request):
    ser = ForgotPasswordSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    user = ser.validated_data['user']

    # Siempre devolvemos 200 para no revelar si el email existe.
    if user:
        token = secrets.token_urlsafe(48)
        PasswordResetToken.objects.create(user=user, token=token)

        base_url = str(getattr(settings, 'FRONTEND_RESET_URL', FRONTEND_RESET_URL)).rstrip('/')
        reset_link = f"{base_url}/{token}"

        subject = "Restablece tu contraseña - Cambioteca"
        from_email = (
            getattr(settings, 'DEFAULT_FROM_EMAIL', None)
            or getattr(settings, 'EMAIL_HOST_USER', None)
            or 'no-reply@cambioteca.local'
        )
        to = [user.email]

        text_body = (
            f"Buen día, {user.nombres}.\n\n"
            f"Te contactamos de Cambioteca para que puedas restaurar tu contraseña.\n"
            f"Enlace: {reset_link}\n\n"
            f"Correo automático, por favor no responder este email.\n\n"
            f"Cambioteca\n"
            f"Creado por Vicente y Nicolas para nuestro proyecto de título :)\n"
        )

        html_body = f"""
        <!doctype html>
        <html lang="es">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <title>Cambioteca - Restablecer contraseña</title>
          <style>
            body {{
              margin: 0; padding: 0; background: #f5f5f5; color: #2b2b2b; font-family: Arial, sans-serif;
            }}
            .wrap {{
              max-width: 560px; margin: 24px auto; background: #ffffff; border-radius: 12px;
              box-shadow: 0 2px 8px rgba(0,0,0,.06); overflow: hidden;
            }}
            .head {{
              background: #aa9797; padding: 18px; text-align: center; color: #fff;
            }}
            .logo {{ width: 120px; height: auto; margin: 8px auto 6px; display: block; }}
            .title {{ margin: 4px 0 0; font-size: 20px; font-weight: 700; }}
            .content {{ padding: 20px; line-height: 1.55; }}
            .cta {{
              display: inline-block; margin: 16px 0; padding: 12px 18px; background: #aa9797; color: #fff;
              text-decoration: none; border-radius: 8px; font-weight: 600;
            }}
            .muted {{ color: #777; font-size: 12px; }}
            .footer {{ padding: 16px; text-align: center; color: #fff; background: #aa9797; }}
          </style>
        </head>
        <body>
          <div class="wrap">
            <div class="head">
              <img class="logo" src="cid:cambioteca_logo" alt="Cambioteca" />
              <div class="title">Cambioteca</div>
            </div>
            <div class="content">
              <p><strong>Buen día, {user.nombres}</strong></p>
              <p>Te contactamos de <strong>Cambioteca</strong> para que puedas restaurar tu contraseña.</p>
              <p><a class="cta" href="{reset_link}">Restablecer contraseña</a></p>
              <p>Enlace directo: <a href="{reset_link}">{reset_link}</a></p>
              <p class="muted">Correo automático — no responder.</p>
              <hr style="border:none;border-top:1px solid #eee;margin:18px 0;">
              <p class="muted">Cambioteca · Creado por Vicente y Nicolas para nuestro proyecto de título :)</p>
            </div>
            <div class="footer">© {timezone.now().year} Cambioteca</div>
          </div>
        </body>
        </html>
        """

        msg = EmailMultiAlternatives(subject, text_body, from_email, to)
        msg.attach_alternative(html_body, "text/html")

        # Adjuntar logo si existe (opcional)
        try:
            logo_path = settings.MEDIA_ROOT / "app" / "cambioteca.png"
        except TypeError:
            logo_path = os.path.join(settings.MEDIA_ROOT, "app", "cambioteca.png")

        try:
            with open(logo_path, "rb") as f:
                img = MIMEImage(f.read())
                img.add_header("Content-ID", "<cambioteca_logo>")
                img.add_header("Content-Disposition", "inline", filename="cambioteca.png")
                msg.attach(img)
        except Exception as e:
            if settings.DEBUG:
                print("WARNING: No se pudo adjuntar el logo:", e)

        try:
            msg.send(fail_silently=False)
        except Exception as e:
            if settings.DEBUG:
                print("EMAIL ERROR:", e)

        if settings.DEBUG:
            print("==== RESET LINK DEV ====", reset_link)

    return Response({"message": "Si el correo existe, se ha enviado un enlace de restablecimiento."})

@api_view(["POST"])
@permission_classes([AllowAny])
def reset_password(request):
    ser = ResetPasswordSerializer(data=request.data)
    if ser.is_valid():
        ser.save()
        return Response({"message": "Contraseña actualizada correctamente."})
    return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

# =========================
# Perfil / resumen / libros
# =========================
@api_view(["GET"])
@permission_classes([AllowAny])
def user_profile_view(request, user_id: int):
    user = Usuario.objects.filter(id_usuario=user_id).first()
    if not user:
        return Response({"detail": "Usuario no encontrado."}, status=404)

    libros_count = Libro.objects.filter(id_usuario_id=user_id, disponible=True).count()

    intercambios_count = (
        Intercambio.objects.filter(
            estado_intercambio='Completado',
            id_solicitud__id_usuario_solicitante_id=user_id
        ).count()
        +
        Intercambio.objects.filter(
            estado_intercambio='Completado',
            id_solicitud__id_usuario_receptor_id=user_id
        ).count()
    )

    agg = Calificacion.objects.filter(id_usuario_calificado_id=user_id).aggregate(
        avg=Avg('puntuacion'), total=Count('id_clasificacion')
    )
    rating_avg = float(agg['avg']) if agg['avg'] is not None else None
    rating_count = int(agg['total'] or 0)

    default_rel = 'avatars/avatardefecto.jpg'
    rel = (user.imagen_perfil or '').strip() or default_rel
    avatar_url = _abs_media_url(request, rel)

    data = {
        "id": user.id_usuario,
        "nombres": user.nombres,
        "apellido_paterno": user.apellido_paterno,
        "apellido_materno": user.apellido_materno,
        "nombre_completo": f"{user.nombres} {user.apellido_paterno}".strip(),
        "email": user.email,
        "rut": user.rut,
        "avatar_url": avatar_url,
        "libros_count": libros_count,
        "intercambios_count": intercambios_count,
        "rating_avg": rating_avg,
        "rating_count": rating_count,
    }
    return Response(data)

@api_view(["GET"])
@permission_classes([AllowAny])
def user_intercambios_view(request, user_id: int):
    from market.models import ImagenLibro, Conversacion

    qs = (
        Intercambio.objects
        .select_related(
            'id_solicitud',
            'id_libro_ofrecido_aceptado',
            'id_solicitud__id_libro_deseado',
            'id_solicitud__id_usuario_solicitante',
            'id_solicitud__id_usuario_receptor'
        )
        .filter(
            Q(id_solicitud__id_usuario_solicitante_id=user_id) |
            Q(id_solicitud__id_usuario_receptor_id=user_id)
        )
        .order_by('-id_intercambio')
    )

    def _portada_abs(libro):
        if not libro:
            return None
        rel = (
            ImagenLibro.objects
            .filter(id_libro=libro)
            .order_by('-is_portada', 'orden', 'id_imagen')
            .values_list('url_imagen', flat=True)
            .first()
        ) or ''
        return _abs_media_url(request, rel)

    out = []
    for i in qs:
        si = i.id_solicitud
        solicitante_nombre = getattr(si.id_usuario_solicitante, 'nombre_usuario', None)
        solicitado_nombre  = getattr(si.id_usuario_receptor,   'nombre_usuario', None)

        ld = si.id_libro_deseado
        lo = i.id_libro_ofrecido_aceptado

        conv = Conversacion.objects.filter(id_intercambio=i).first()

        out.append({
            "id": i.id_intercambio,
            "estado": i.estado_intercambio,
            "fecha_intercambio": (
                i.fecha_intercambio_pactada or
                i.fecha_completado or
                si.actualizada_en or
                si.creada_en
            ),
            "solicitante": solicitante_nombre,
            "ofreciente": solicitante_nombre,
            "solicitado": solicitado_nombre,
            "libro_deseado": {
                "id": getattr(ld, 'id_libro', None),
                "titulo": getattr(ld, 'titulo', None),
                "portada": _portada_abs(ld),
            },
            "libro_ofrecido": {
                "id": getattr(lo, 'id_libro', None),
                "titulo": getattr(lo, 'titulo', None),
                "portada": _portada_abs(lo),
            },
            "lugar": i.lugar_intercambio,
            "conversacion_id": getattr(conv, "id_conversacion", None),
        })

    return Response(out)

@api_view(["GET"])
@permission_classes([AllowAny])
def user_books_view(request, user_id: int):
    from market.models import ImagenLibro

    qs = (Libro.objects
          .filter(id_usuario_id=user_id, disponible=True)
          .only("id_libro", "titulo", "autor", "fecha_subida")
          .order_by("-fecha_subida", "-id_libro"))

    def _portada_abs(l):
        rel = (ImagenLibro.objects
               .filter(id_libro=l)
               .order_by("-is_portada", "orden", "id_imagen")
               .values_list("url_imagen", flat=True)
               .first()) or ""
        return _abs_media_url(request, rel)

    out = [{
        "id": b.id_libro,
        "titulo": b.titulo,
        "autor": b.autor,
        "portada": _portada_abs(b),
        "fecha_subida": b.fecha_subida,
    } for b in qs]

    return Response(out)

@api_view(["GET"])
@permission_classes([AllowAny])
def user_summary(request, id: int):
    u = Usuario.objects.filter(pk=id, activo=True).select_related('comuna').first()
    if not u:
        return Response({"detail": "Usuario no encontrado"}, status=404)

    if u.imagen_perfil:
        u.imagen_perfil = u.imagen_perfil.replace("\\", "/")

    libros = Libro.objects.filter(id_usuario=id, disponible=True).count()
    inter = Intercambio.objects.filter(
        Q(id_solicitud__id_usuario_solicitante=id) | Q(id_solicitud__id_usuario_receptor=id),
        estado_intercambio='Completado'
    ).count()
    rating = (Calificacion.objects
              .filter(id_usuario_calificado=id)
              .aggregate(avg=Avg("puntuacion"))
              .get("avg") or 0)

    recents = (Intercambio.objects
           .select_related('id_solicitud', 'id_libro_ofrecido_aceptado', 'id_solicitud__id_libro_deseado')
           .filter(Q(id_solicitud__id_usuario_solicitante=id) | Q(id_solicitud__id_usuario_receptor=id))
           .order_by("-id_intercambio")[:10])

    history = []
    for it in recents:
        si = it.id_solicitud
        a = getattr(it.id_libro_ofrecido_aceptado, 'titulo', None)
        b = getattr(si.id_libro_deseado, 'titulo', None)
        titulo = f"{a or '¿?'} ↔ {b or '¿?'}"
        history.append({
            "id": it.id_intercambio,
            "titulo": titulo,
            "estado": it.estado_intercambio,
            "fecha": it.fecha_intercambio_pactada or it.fecha_completado,
        })

    default_rel = "avatars/avatardefecto.jpg"
    pic_rel = u.imagen_perfil or default_rel
    avatar_url = _abs_media_url(request, pic_rel)

    user_payload = {
        "id_usuario": u.id_usuario,
        "email": u.email,
        "nombres": u.nombres,
        "apellido_paterno": u.apellido_paterno,
        "apellido_materno": u.apellido_materno,
        "nombre_usuario": u.nombre_usuario,
        "imagen_perfil": u.imagen_perfil,
        "avatar_url": avatar_url,  # URL absoluta
        "verificado": u.verificado,
        "rut": u.rut,
        "telefono": u.telefono,
        "direccion": u.direccion,
        "numeracion": u.numeracion,
        "direccion_completa": f"{(u.direccion or '').strip()} {(u.numeracion or '').strip()}".strip(),
        "comuna_id": getattr(u.comuna, "id_comuna", None),
        "comuna_nombre": getattr(u.comuna, "nombre", None),
    }

    return Response({
        "user": user_payload,
        "metrics": {
            "libros": libros,
            "intercambios": inter,
            "calificacion": float(rating or 0)
        },
        "history": history,
    })

# =========================
# Perfil: edición y avatar
# =========================
EDITABLE_FIELDS = {"nombres", "apellido_paterno", "apellido_materno", "telefono", "direccion", "numeracion"}

@api_view(["PATCH"])
@permission_classes([AllowAny])  # cambia a IsAuthenticated cuando actives auth real
def update_user_profile(request, id: int):
    u = Usuario.objects.filter(pk=id, activo=True).first()
    if not u:
        return Response({"detail": "Usuario no encontrado"}, status=404)

    for f in EDITABLE_FIELDS:
        if f in request.data:
            setattr(u, f, (request.data.get(f) or "").strip())
    u.save()

    data = UsuarioSummarySerializer(u).data
    data.update({
        "telefono": u.telefono,
        "direccion": u.direccion,
        "numeracion": u.numeracion,
        "direccion_completa": f"{u.direccion or ''} {u.numeracion or ''}".strip(),
    })
    return Response(data)

@api_view(["PATCH"])
@permission_classes([AllowAny])  # o IsAuthenticated
@parser_classes([MultiPartParser, FormParser])
def update_user_avatar(request, id: int):
    u = Usuario.objects.filter(pk=id, activo=True).first()
    if not u:
        return Response({"detail": "Usuario no encontrado"}, status=404)

    file_obj = request.FILES.get("imagen_perfil")
    if not file_obj:
        return Response({"detail": "Falta el archivo 'imagen_perfil'."}, status=400)

    # Validaciones básicas
    if file_obj.size > 5 * 1024 * 1024:
        return Response({"detail": "La imagen no puede superar 5 MB."}, status=400)
    if not file_obj.content_type.startswith("image/"):
        return Response({"detail": "El archivo debe ser una imagen."}, status=400)

    try:
        rel = _save_avatar(file_obj)
        u.imagen_perfil = rel
        u.save(update_fields=["imagen_perfil"])
        abs_url = _abs_media_url(request, rel)
        return Response({"imagen_perfil": rel, "avatar_url": abs_url}, status=200)
    except Exception as e:
        return Response({"detail": f"No se pudo guardar: {e}"}, status=400)

# =========================
# Cambio de contraseña
# =========================
@api_view(["POST"])
@permission_classes([AllowAny])
def change_password_by_userid(request):
    """
    Body: { "user_id": 123, "current": "...", "new": "..." }
    (Menos seguro. Mejor usar la versión autenticada abajo)
    """
    user_id = request.data.get("user_id")
    current = request.data.get("current") or ""
    new = request.data.get("new") or ""

    if not user_id or not current or not new:
        return Response({"detail": "Datos incompletos."}, status=400)

    user = Usuario.objects.filter(id_usuario=user_id).first()
    if not user:
        return Response({"detail": "Usuario no encontrado."}, status=404)

    ok = False
    try:
        ok = check_password(current, user.contrasena)
    except Exception:
        ok = False
    if not ok and user.contrasena == current:
        ok = True

    if not ok:
        return Response({"detail": "Contraseña actual incorrecta."}, status=400)

    user.contrasena = make_password(new)
    user.save(update_fields=['contrasena'])
    return Response({"message": "Contraseña actualizada."})

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_password_view(request):
    """
    Requiere que el request.user venga autenticado por tu UsuarioJWTAuthentication.
    """
    user = request.user
    current = request.data.get("current") or ""
    new = request.data.get("new") or ""

    if not current or not new:
        return Response({"detail": "Datos incompletos."}, status=400)

    ok = False
    try:
        ok = check_password(current, user.contrasena)
    except Exception:
        ok = False
    if not ok and user.contrasena == current:
        ok = True
    if not ok:
        return Response({"detail": "Contraseña actual incorrecta."}, status=400)

    user.contrasena = make_password(new)
    user.save(update_fields=['contrasena'])
    return Response({"message": "Contraseña actualizada."})

# =========================
# VISTAS DE ADMINISTRACIÓN
# =========================
@api_view(['GET'])
@permission_classes([IsCambiotecaAdmin])
def admin_dashboard_summary(request):
    """
    Estadísticas completas para dashboard admin.
    - Totales de usuarios/libros/intercambios
    - Series por día/mes
    - Top usuarios (más intercambios, más libros, mejor calificados, más solicitudes)
    - Géneros más publicados e intercambiados
    """
    now = timezone.now()
    seven_days_ago = now - timedelta(days=7)
    thirty_days_ago = now - timedelta(days=30)

    # ---------- USUARIOS ----------
    # Solo usuarios activos que no son admin
    total_users = Usuario.objects.filter(activo=True, es_admin=False).count()

    try:
        new_users_last_7_days = Usuario.objects.filter(
            fecha_registro__gte=seven_days_ago,
            activo=True,
            es_admin=False,
        ).count()
    except Exception:
        new_users_last_7_days = 0

    # Usuarios por región
    users_by_region = (
        Usuario.objects
        .filter(activo=True, es_admin=False)
        .values('comuna__id_region__nombre')
        .annotate(total=Count('id_usuario'))
        .order_by('-total')
    )

    # ---------- LIBROS ----------
    total_books = Libro.objects.count()
    available_books = Libro.objects.filter(disponible=True).count()

    books_last_7_days = Libro.objects.filter(fecha_subida__gte=seven_days_ago).count()
    books_last_30_days = Libro.objects.filter(fecha_subida__gte=thirty_days_ago).count()

    # Mes actual y mes anterior (para comparar libros subidos)
    current_month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if now.month == 1:
        prev_month_year = now.year - 1
        prev_month = 12
    else:
        prev_month_year = now.year
        prev_month = now.month - 1

    previous_month_start = current_month_start.replace(
        year=prev_month_year,
        month=prev_month,
        day=1,
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )

    books_current_month = Libro.objects.filter(
        fecha_subida__gte=current_month_start
    ).count()

    books_previous_month = Libro.objects.filter(
        fecha_subida__gte=previous_month_start,
        fecha_subida__lt=current_month_start,
    ).count()

    # Libros por día (últimos 30 días)
    books_by_day_30_qs = (
        Libro.objects
        .filter(fecha_subida__gte=thirty_days_ago)
        .annotate(d=TruncDay('fecha_subida'))
        .values('d')
        .annotate(total=Count('id_libro'))
        .order_by('d')
    )
    books_by_day_30 = [
        {"date": row["d"].date().isoformat(), "total": row["total"]}
        for row in books_by_day_30_qs
    ]

    # Libros por mes (todo el histórico, tú puedes cortar a 12 en el front)
    books_by_month_qs = (
        Libro.objects
        .annotate(m=TruncMonth('fecha_subida'))
        .values('m')
        .annotate(total=Count('id_libro'))
        .order_by('m')
    )
    books_by_month = [
        {"month": row["m"].date().isoformat(), "total": row["total"]}
        for row in books_by_month_qs
    ]

    # ---------- INTERCAMBIOS ----------
    completed_exchanges = (
        Intercambio.objects
        .filter(estado_intercambio='Completado')
        .distinct()
        .count()
    )
    in_progress_exchanges = (
        Intercambio.objects
        .filter(estado_intercambio='Aceptado')
        .distinct()
        .count()
    )

    exchanges_last_7_days = (
        Intercambio.objects
        .filter(
            estado_intercambio='Completado',
            fecha_completado__gte=seven_days_ago,
        )
        .count()
    )

    # Intercambios completados por día (últimos 30 días)
    exchanges_by_day_30_qs = (
        Intercambio.objects
        .filter(
            estado_intercambio='Completado',
            fecha_completado__isnull=False,
            fecha_completado__gte=thirty_days_ago,
        )
        .annotate(d=TruncDay('fecha_completado'))
        .values('d')
        .annotate(total=Count('id_intercambio'))
        .order_by('d')
    )
    exchanges_by_day_30 = [
        {"date": row["d"].date().isoformat(), "total": row["total"]}
        for row in exchanges_by_day_30_qs
    ]

    # Intercambios completados por mes
    exchanges_by_month_qs = (
        Intercambio.objects
        .filter(
            estado_intercambio='Completado',
            fecha_completado__isnull=False,
        )
        .annotate(m=TruncMonth('fecha_completado'))
        .values('m')
        .annotate(total=Count('id_intercambio'))
        .order_by('m')
    )
    exchanges_by_month = [
        {"month": row["m"].date().isoformat(), "total": row["total"]}
        for row in exchanges_by_month_qs
    ]

    # ---------- TOP USUARIOS ----------
    # Top activos (más intercambios completados = solicitante + receptor)
    completed_as_solicitante_sq = (
        Intercambio.objects
        .filter(
            estado_intercambio='Completado',
            id_solicitud__id_usuario_solicitante_id=OuterRef('id_usuario'),
        )
        .values('id_solicitud__id_usuario_solicitante_id')
        .annotate(c=Count('id_intercambio', distinct=True))
        .values('c')[:1]
    )

    completed_as_receptor_sq = (
        Intercambio.objects
        .filter(
            estado_intercambio='Completado',
            id_solicitud__id_usuario_receptor_id=OuterRef('id_usuario'),
        )
        .values('id_solicitud__id_usuario_receptor_id')
        .annotate(c=Count('id_intercambio', distinct=True))
        .values('c')[:1]
    )

    top_active_users_qs = (
        Usuario.objects
        .filter(activo=True, es_admin=False)
        .annotate(
            completed_as_solicitante=Coalesce(
                Subquery(completed_as_solicitante_sq, output_field=IntegerField()),
                Value(0),
            ),
            completed_as_receptor=Coalesce(
                Subquery(completed_as_receptor_sq, output_field=IntegerField()),
                Value(0),
            ),
        )
        .annotate(
            total_completed_exchanges=F('completed_as_solicitante') + F('completed_as_receptor')
        )
        .filter(total_completed_exchanges__gt=0)
        .order_by('-total_completed_exchanges', 'nombre_usuario')[:5]
        .values('id_usuario', 'nombre_usuario', 'email', 'total_completed_exchanges')
    )

    # Top publicadores (más libros subidos)
    top_publishers_qs = (
        Libro.objects
        .values(
            'id_usuario__id_usuario',
            'id_usuario__nombre_usuario',
            'id_usuario__email',
        )
        .annotate(books_count=Count('id_libro', distinct=True))
        .order_by('-books_count')[:5]
    )

    # Top solicitantes (más solicitudes de intercambio creadas)
    top_requesters_qs = (
        SolicitudIntercambio.objects
        .values(
            'id_usuario_solicitante__id_usuario',
            'id_usuario_solicitante__nombre_usuario',
            'id_usuario_solicitante__email',
        )
        .annotate(solicitudes_count=Count('id_solicitud', distinct=True))
        .order_by('-solicitudes_count')[:5]
    )

    # Top mejor calificados
    top_rated_qs = (
        Calificacion.objects
        .values(
            'id_usuario_calificado__id_usuario',
            'id_usuario_calificado__nombre_usuario',
            'id_usuario_calificado__email',
        )
        .annotate(
            promedio=Avg('puntuacion'),
            total=Count('id_clasificacion'),
        )
        .filter(total__gte=1)
        .order_by('-promedio', '-total')[:5]
    )

    # ---------- GÉNEROS ----------
    # Géneros más publicados (por cantidad de libros)
    genres_books_qs = (
        Libro.objects
        .values('id_genero__nombre')
        .annotate(total=Count('id_libro'))
        .order_by('-total')[:10]
    )
    genres_books = [
        {
            "genre": row["id_genero__nombre"] or "Sin género",
            "total": row["total"],
        }
        for row in genres_books_qs
    ]

    # Géneros más intercambiados (sumando libro deseado + libro ofrecido)
    genres_exchanges_counter = defaultdict(int)

    # Por libro deseado
    q_deseado = (
        Intercambio.objects
        .filter(estado_intercambio='Completado')
        .values('id_solicitud__id_libro_deseado__id_genero__nombre')
        .annotate(total=Count('id_intercambio', distinct=True))
    )
    for row in q_deseado:
        name = row['id_solicitud__id_libro_deseado__id_genero__nombre'] or "Sin género"
        genres_exchanges_counter[name] += row['total']

    # Por libro ofrecido
    q_ofrecido = (
        Intercambio.objects
        .filter(estado_intercambio='Completado')
        .values('id_libro_ofrecido_aceptado__id_genero__nombre')
        .annotate(total=Count('id_intercambio', distinct=True))
    )
    for row in q_ofrecido:
        name = row['id_libro_ofrecido_aceptado__id_genero__nombre'] or "Sin género"
        genres_exchanges_counter[name] += row['total']

    genres_exchanges = [
        {"genre": name, "total": total}
        for name, total in genres_exchanges_counter.items()
    ]
    genres_exchanges.sort(key=lambda x: x["total"], reverse=True)
    genres_exchanges = genres_exchanges[:10]

    # ---------- ARMAR RESPUESTA ----------
    return Response({
        # Totales "simples" que ya usas
        "total_users": total_users,
        "new_users_last_7_days": new_users_last_7_days,
        "total_books": total_books,
        "completed_exchanges": completed_exchanges,
        "in_progress_exchanges": in_progress_exchanges,

        # Usuarios por región (para tu gráfico de barras horizontal)
        "users_by_region": list(users_by_region),

        # Stats de libros (para comparaciones mes actual / mes pasado, etc.)
        "books_stats": {
            "total": total_books,
            "available": available_books,
            "last_7_days": books_last_7_days,
            "last_30_days": books_last_30_days,
            "current_month": books_current_month,
            "previous_month": books_previous_month,
            "by_day_last_30": books_by_day_30,
            "by_month": books_by_month,
        },

        # Stats de intercambios
        "exchanges_stats": {
            "completed_total": completed_exchanges,
            "in_progress_total": in_progress_exchanges,
            "last_7_days": exchanges_last_7_days,
            "by_day_last_30": exchanges_by_day_30,
            "by_month": exchanges_by_month,
        },

        # Top usuarios
        "top_active_users": list(top_active_users_qs),
        "top_publishers": list(top_publishers_qs),
        "top_requesters": list(top_requesters_qs),
        "top_rated_users": list(top_rated_qs),

        # Géneros
        "genres_books": genres_books,
        "genres_exchanges": genres_exchanges,
    })

@api_view(['GET'])
@permission_classes([IsCambiotecaAdmin])
def admin_get_all_users(request):
    users = Usuario.objects.all().order_by('-id_usuario')
    serializer = UsuarioLiteSerializer(users, many=True)
    return Response(serializer.data)

@api_view(["POST"])
@permission_classes([IsCambiotecaAdmin])
def admin_toggle_user_active(request, user_id: int):
    """
    Bloquea/desbloquea usuarios. Envía email al deshabilitar.
    """
    try:
        user_to_toggle = Usuario.objects.get(pk=user_id)
    except Usuario.DoesNotExist:
        return Response({"detail": "Usuario no encontrado."}, status=status.HTTP_404_NOT_FOUND)

    if request.user.id_usuario == user_to_toggle.id_usuario:
        return Response({"detail": "No puedes bloquearte a ti mismo."}, status=400)

    was_active_before = user_to_toggle.activo
    user_to_toggle.activo = not user_to_toggle.activo
    user_to_toggle.save(update_fields=['activo'])

    # Si lo deshabilitamos, opcionalmente invalidar tokens (si usas token_version)
    # Usuario.objects.filter(pk=user_id).update(token_version=F('token_version') + 1)

    if was_active_before and not user_to_toggle.activo:
        try:
            user_name = user_to_toggle.nombres or user_to_toggle.nombre_usuario or "usuario"
            send_mail(
                'Tu cuenta en Cambioteca ha sido deshabilitada',
                f'Hola {user_name},\n\n'
                'Te informamos que tu cuenta en Cambioteca ha sido deshabilitada por un administrador.\n'
                'No podrás iniciar sesión ni realizar intercambios.\n\n'
                'Si crees que esto es un error, por favor contacta a soporte.\n\n'
                'Saludos,\nEl equipo de Cambioteca',
                getattr(settings, 'DEFAULT_FROM_EMAIL', 'no-reply@cambioteca.local'),
                [user_to_toggle.email],
                fail_silently=False,
            )
        except Exception as e:
            print(f"[ADMIN] Error al enviar email a {user_to_toggle.email}: {e}")

    return Response({
        "message": "Estado del usuario actualizado.",
        "id_usuario": user_to_toggle.id_usuario,
        "activo": user_to_toggle.activo,
    })

@api_view(['DELETE'])
@permission_classes([IsCambiotecaAdmin])
def admin_delete_user(request, user_id: int):
    if request.user.id_usuario == user_id:
        return Response({"detail": "No puedes eliminarte a ti mismo."}, status=400)

    user = Usuario.objects.filter(pk=user_id).first()
    if not user:
        return Response({"detail": "Usuario no encontrado."}, status=404)

    try:
        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    except Exception as e:
        return Response({"detail": f"No se pudo eliminar al usuario: {e}"}, status=409)

@api_view(["GET"])
@permission_classes([AllowAny])
def user_ratings_view(request, user_id: int):
    """
    GET /api/users/<user_id>/ratings/

    Devuelve todas las calificaciones donde el usuario participa:
    - tipo: 'recibida' o 'enviada'
    - estrellas, comentario
    - libro_titulo (A ↔ B)
    - contraparte_nombre (quien calificó o a quien califiqué)
    - fecha (basada en el intercambio)
    """
    # Verificar que el usuario exista
    user = Usuario.objects.filter(id_usuario=user_id, activo=True).first()
    if not user:
        return Response({"detail": "Usuario no encontrado."}, status=404)

    # Traer calificaciones donde participa (como calificador o calificado)
    califs = (
        Calificacion.objects
        .filter(
            Q(id_usuario_calificador_id=user_id) |
            Q(id_usuario_calificado_id=user_id)
        )
        .select_related(
            "id_intercambio",
            "id_intercambio__id_solicitud",
            "id_intercambio__id_libro_ofrecido_aceptado",
            "id_intercambio__id_solicitud__id_libro_deseado",
            "id_usuario_calificador",
            "id_usuario_calificado",
        )
        .order_by("-id_clasificacion")
    )

    out = []
    for c in califs:
        it = getattr(c, "id_intercambio", None)
        si = getattr(it, "id_solicitud", None)
        lo = getattr(it, "id_libro_ofrecido_aceptado", None)
        ld = getattr(si, "id_libro_deseado", None)

        # Título del intercambio: "Libro A ↔ Libro B"
        t_a = getattr(lo, "titulo", None)
        t_b = getattr(ld, "titulo", None)
        if t_a or t_b:
            libro_titulo = f"{t_a or '¿?'} ↔ {t_b or '¿?'}"
        else:
            libro_titulo = "Intercambio de libros"

        # Determinar si para ESTE usuario la calificación es recibida o enviada
        if c.id_usuario_calificado_id == user_id:
            tipo = "recibida"
            contraparte = getattr(c, "id_usuario_calificador", None)
        else:
            tipo = "enviada"
            contraparte = getattr(c, "id_usuario_calificado", None)

        contraparte_nombre = (
            getattr(contraparte, "nombre_usuario", None)
            or getattr(contraparte, "nombres", None)
            or getattr(contraparte, "email", None)
        )

        # Fecha: usamos la lógica similar a user_intercambios_view
        fecha = None
        if it:
            fecha = (
                getattr(it, "fecha_completado", None)
                or getattr(it, "fecha_intercambio_pactada", None)
            )
        if not fecha and si:
            fecha = (
                getattr(si, "actualizada_en", None)
                or getattr(si, "creada_en", None)
            )

        out.append({
            "id": getattr(c, "id_clasificacion", None),
            "intercambio_id": getattr(it, "id_intercambio", None),
            "tipo": tipo,  # 'recibida' | 'enviada'
            "estrellas": c.puntuacion,
            "comentario": c.comentario or "",
            "fecha": fecha,
            "libro_titulo": libro_titulo,
            "contraparte_nombre": contraparte_nombre,
        })

    return Response(out)
