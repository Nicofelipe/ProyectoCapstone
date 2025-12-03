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


from rest_framework.response import Response
from rest_framework import status
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from market.views import media_abs
from django.http import HttpResponse
from django.shortcuts import redirect


from .permissions import IsAdminUser as IsCambiotecaAdmin  # <- tu permiso custom
from .models import PasswordResetToken, Usuario, Region, Comuna, Donacion
from .serializers import (
    RegisterSerializer, RegionSerializer, ComunaSerializer,
    ForgotPasswordSerializer, ResetPasswordSerializer,
    UsuarioLiteSerializer, UsuarioSummarySerializer
)
from django.db.models.functions import Coalesce, TruncDay, TruncMonth
from collections import defaultdict
from django.db.models import (
 OuterRef, Subquery, IntegerField, Value, Sum,
)
from market.models import (
    Libro,
    Intercambio,
    Calificacion,
    SolicitudIntercambio,
    Genero,
)

from core.webpay_plus import get_transaction
from django.shortcuts import redirect
from transbank.webpay.webpay_plus.transaction import Transaction


from market.models import Libro, Intercambio, Calificacion

import jwt
import datetime
import os
import uuid
import secrets

# =========================
# Helpers
# =========================
def _abs_media_url(request, rel_path: str | None = None) -> str:
    """
    Wrapper hacia market.media_abs para unificar la lógica de media.
    Soporta MEDIA_URL relativo o absoluto y paths ya absolutos.
    """
    return media_abs(request, rel_path or None)



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
    - Donaciones (a partir de la tabla de donaciones)
    """
    now = timezone.now()
    seven_days_ago = now - timedelta(days=7)
    thirty_days_ago = now - timedelta(days=30)

    # ---------- USUARIOS ----------
    total_users = Usuario.objects.filter(activo=True, es_admin=False).count()

    try:
        new_users_last_7_days = Usuario.objects.filter(
            fecha_registro__gte=seven_days_ago,
            activo=True,
            es_admin=False,
        ).count()
    except Exception:
        new_users_last_7_days = 0

    users_by_region_qs = (
        Usuario.objects
        .filter(activo=True, es_admin=False)
        .values('comuna__id_region__nombre')
        .annotate(total=Count('id_usuario'))
        .order_by('-total')
    )
    users_by_region = [
        {
            "region": row["comuna__id_region__nombre"] or "Sin región",
            "total": row["total"],
        }
        for row in users_by_region_qs
    ]

    # ---------- LIBROS ----------
    total_books = Libro.objects.count()
    available_books = Libro.objects.filter(disponible=True).count()

    books_last_7_days = Libro.objects.filter(fecha_subida__gte=seven_days_ago).count()
    books_last_30_days = Libro.objects.filter(fecha_subida__gte=thirty_days_ago).count()

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

    top_rated_qs = (
        Calificacion.objects
        .values(
            'id_usuario_calificado__id_usuario',
            'id_usuario_calificado__nombre_usuario',
            'id_usuario_calificado__email',
        )
        .annotate(
            promedio=Avg('puntuacion'),
            total=Count('pk'),
        )
        .filter(total__gte=1)
        .order_by('-promedio', '-total')[:5]
    )

    # ---------- GÉNEROS ----------
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

    genres_exchanges_counter = defaultdict(int)

    q_deseado = (
        Intercambio.objects
        .filter(estado_intercambio='Completado')
        .values('id_solicitud__id_libro_deseado__id_genero__nombre')
        .annotate(total=Count('id_intercambio', distinct=True))
    )
    for row in q_deseado:
        name = row['id_solicitud__id_libro_deseado__id_genero__nombre'] or "Sin género"
        genres_exchanges_counter[name] += row['total']

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

    # ---------- DONACIONES ----------
    # Si algo falla (modelo, campo, etc.), devolvemos todo en 0 para no romper el dashboard
    # ---------- DONACIONES ----------
    # Valores por defecto, por si algo falla
    donations_stats = {
        "total_count": 0,
        "total_amount": 0,
        "last_30_days": {
            "count": 0,
            "amount": 0,
        },
        "by_month": [],
        "current_month": {
            "count": 0,
            "amount": 0,
        },
        "previous_month": {
            "count": 0,
            "amount": 0,
        },
        "variation": {
            "count_percent": None,
            "amount_percent": None,
        },
    }

    try:
        # Solo donaciones aprobadas
        donations_qs = Donacion.objects.filter(estado__iexact="APROBADA")

        # Totales globales
        total_donations_count = donations_qs.count()
        total_donations_amount = donations_qs.aggregate(
            total=Coalesce(Sum("monto"), Value(0))
        )["total"] or 0

        # Últimos 30 días (OJO: usamos created_at, no fecha)
        donations_last_30_qs = donations_qs.filter(created_at__gte=thirty_days_ago)
        donations_last_30 = {
            "count": donations_last_30_qs.count(),
            "amount": donations_last_30_qs.aggregate(
                total=Coalesce(Sum("monto"), Value(0))
            )["total"] or 0,
        }

        # Agrupado por mes
        donations_by_month_qs = (
            donations_qs
            .annotate(m=TruncMonth("created_at"))
            .values("m")
            .annotate(
                count=Count("pk"),
                amount=Coalesce(Sum("monto"), Value(0)),
            )
            .order_by("m")
        )
        donations_by_month = [
            {
                "month": row["m"].date().isoformat(),
                "count": row["count"],
                "amount": row["amount"],
            }
            for row in donations_by_month_qs
        ]

        # Mes actual
        donations_current_month_qs = donations_qs.filter(
            created_at__gte=current_month_start
        )
        donations_current_month = {
            "count": donations_current_month_qs.count(),
            "amount": donations_current_month_qs.aggregate(
                total=Coalesce(Sum("monto"), Value(0))
            )["total"] or 0,
        }

        # Mes anterior
        donations_previous_month_qs = donations_qs.filter(
            created_at__gte=previous_month_start,
            created_at__lt=current_month_start,
        )
        donations_previous_month = {
            "count": donations_previous_month_qs.count(),
            "amount": donations_previous_month_qs.aggregate(
                total=Coalesce(Sum("monto"), Value(0))
            )["total"] or 0,
        }

        # Variaciones %
        def _variation(current, previous):
            if previous and float(previous) != 0:
                return round(
                    (float(current) - float(previous)) * 100.0 / float(previous),
                    2,
                )
            return None

        donations_variation = {
            "count_percent": _variation(
                donations_current_month["count"],
                donations_previous_month["count"],
            ),
            "amount_percent": _variation(
                donations_current_month["amount"],
                donations_previous_month["amount"],
            ),
        }

        donations_stats = {
            "total_count": total_donations_count,
            "total_amount": total_donations_amount,
            "last_30_days": donations_last_30,
            "by_month": donations_by_month,
            "current_month": donations_current_month,
            "previous_month": donations_previous_month,
            "variation": donations_variation,
        }

    except Exception as e:
        import logging
        logging.exception(
            "Error en bloque de donaciones del admin_dashboard_summary"
        )

    # ---------- RESPUESTA ----------
    return Response({
        "total_users": total_users,
        "new_users_last_7_days": new_users_last_7_days,
        "total_books": total_books,
        "available_books": available_books,
        "completed_exchanges": completed_exchanges,
        "in_progress_exchanges": in_progress_exchanges,
        "intercambios_completados": completed_exchanges,
        "intercambios_pendientes": in_progress_exchanges,

        "users_by_region": users_by_region,

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

        "exchanges_stats": {
            "completed_total": completed_exchanges,
            "in_progress_total": in_progress_exchanges,
            "last_7_days": exchanges_last_7_days,
            "by_day_last_30": exchanges_by_day_30,
            "by_month": exchanges_by_month,
        },

        "top_active_users": list(top_active_users_qs),
        "top_publishers": list(top_publishers_qs),
        "top_requesters": list(top_requesters_qs),
        "top_rated_users": list(top_rated_qs),

        "genres_books": genres_books,
        "genres_exchanges": genres_exchanges,

        "donations_stats": donations_stats,
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

from django.db import IntegrityError
from django.db.models import Q
from market.models import Libro, Intercambio

@api_view(['DELETE'])
@permission_classes([IsCambiotecaAdmin])
def admin_delete_user(request, user_id: int):
    if request.user.id_usuario == user_id:
        return Response({"detail": "No puedes eliminarte a ti mismo."}, status=400)

    user = Usuario.objects.filter(pk=user_id).first()
    if not user:
        return Response({"detail": "Usuario no encontrado."}, status=404)

    # 👉 1) Reglas de negocio: no borrar si tiene libros o intercambios
    tiene_libros = Libro.objects.filter(id_usuario_id=user_id).exists()
    tiene_intercambios = Intercambio.objects.filter(
        Q(id_solicitud__id_usuario_solicitante_id=user_id) |
        Q(id_solicitud__id_usuario_receptor_id=user_id)
    ).exists()

    if tiene_libros or tiene_intercambios:
        return Response(
            {
                "detail": (
                    "No se puede eliminar un usuario que tiene libros o "
                    "intercambios asociados. Desactívalo en su lugar."
                )
            },
            status=400,
        )

    # 👉 2) Si no tiene actividad, intentar borrar
    try:
        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    except IntegrityError:
        # Por si hay alguna otra FK que se nos pasó
        return Response(
            {
                "detail": (
                    "No se pudo eliminar al usuario porque tiene datos "
                    "relacionados. Desactívalo en su lugar."
                )
            },
            status=409,
        )
    except Exception as e:
        return Response(
            {"detail": f"No se pudo eliminar al usuario: {e}"},
            status=409,
        )


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




@api_view(["POST"])
@permission_classes([AllowAny])
def donaciones_crear(request):
    """
    Crea Donacion en estado PENDIENTE e inicia Webpay.
    """
    # 👇 COPIA aquí el cuerpo que ya tienes en crear_donacion
    try:
        monto = int(request.data.get("monto") or 0)
    except (TypeError, ValueError):
        return Response({"detail": "Monto inválido."}, status=status.HTTP_400_BAD_REQUEST)

    if monto <= 0:
        return Response({"detail": "El monto debe ser mayor a 0."}, status=status.HTTP_400_BAD_REQUEST)

    user_id = request.data.get("user_id") or request.query_params.get("user_id")
    usuario = None
    if user_id:
        try:
            usuario = Usuario.objects.get(pk=int(user_id))
        except (Usuario.DoesNotExist, ValueError):
            usuario = None

    buy_order = f"DON-{timezone.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6].upper()}"

    donacion = Donacion.objects.create(
        id_usuario=usuario,
        monto=monto,
        estado="PENDIENTE",
        orden_compra=buy_order,
        created_at=timezone.now(),
    )

    tx = get_transaction()
    return_url = settings.WEBPAY_RETURN_URL

    try:
        resp = tx.create(
            buy_order=buy_order,
            session_id=str(usuario.id_usuario) if usuario else "anon",
            amount=monto,
            return_url=return_url,
        )
    except Exception as e:
        donacion.estado = "ERROR"
        donacion.save(update_fields=["estado"])
        return Response({"detail": "No se pudo iniciar el pago.", "error": str(e)},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    token = resp.get("token")
    url = resp.get("url")

    if not token or not url:
        donacion.estado = "ERROR"
        donacion.save(update_fields=["estado"])
        return Response({"detail": "Respuesta inválida desde Webpay."},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    donacion.token = token
    donacion.save(update_fields=["token"])

    redirect_url = f"{url}?token_ws={token}"

    return Response({
        "donacion_id": donacion.id_donacion,
        "buy_order": buy_order,
        "url": url,
        "token": token,
        "redirect_url": redirect_url,
    })



@api_view(["POST"])
@permission_classes([AllowAny])  # o IsAuthenticated si quieres obligar login
def crear_donacion(request):
    """
    Crea un registro Donacion en estado PENDIENTE e inicia Webpay.
    Body:
      - monto (int, obligatorio)
      - user_id (opcional)
    """
    # 1) Validar monto
    try:
        monto = int(request.data.get("monto") or 0)
    except (TypeError, ValueError):
        return Response({"detail": "Monto inválido."}, status=status.HTTP_400_BAD_REQUEST)

    if monto <= 0:
        return Response(
            {"detail": "El monto debe ser mayor a 0."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # 2) Usuario opcional
    user_id = request.data.get("user_id") or request.query_params.get("user_id")
    usuario = None
    if user_id:
        try:
            usuario = Usuario.objects.get(pk=int(user_id))
        except (Usuario.DoesNotExist, ValueError):
            usuario = None

    # 3) Generar orden de compra única
    buy_order = f"DON-{timezone.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6].upper()}"

    # 4) Crear donación en la BD
    donacion = Donacion.objects.create(
        id_usuario=usuario,
        monto=monto,
        estado="PENDIENTE",
        orden_compra=buy_order,
        created_at=timezone.now(),
    )

    # 5) Iniciar transacción Webpay
    tx = get_transaction()
    return_url = settings.WEBPAY_RETURN_URL

    try:
        resp = tx.create(
            buy_order=buy_order,
            session_id=str(usuario.id_usuario) if usuario else "anon",
            amount=monto,
            return_url=return_url,
        )
    except Exception as e:
        # Si falla Webpay, marcamos la donación como ERROR
        donacion.estado = "ERROR"
        donacion.save(update_fields=["estado"])
        return Response(
            {"detail": "No se pudo iniciar el pago.", "error": str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    token = resp.get("token")
    url = resp.get("url")

    if not token or not url:
        donacion.estado = "ERROR"
        donacion.save(update_fields=["estado"])
        return Response(
            {"detail": "Respuesta inválida desde Webpay."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    # Guardar token en la donación
    donacion.token = token
    donacion.save(update_fields=["token"])

    # URL final a la que debe ir el usuario (la que usas en Ionic)
    redirect_url = f"{url}?token_ws={token}"

    return Response(
        {
            "donacion_id": donacion.id_donacion,
            "buy_order": buy_order,
            "url": url,
            "token": token,
            "redirect_url": redirect_url,
        },
        status=status.HTTP_201_CREATED,
    )


# core/views.py
from django.http import HttpResponse   # asegúrate de tener este import

@api_view(["POST", "GET"])
@permission_classes([AllowAny])
def webpay_donacion_confirmar(request):
    token = (
        request.POST.get("token_ws")
        or request.GET.get("token_ws")
        or request.POST.get("TBK_TOKEN")
        or request.GET.get("TBK_TOKEN")
    )

    if not token:
        return HttpResponse("Token no recibido.", status=400)

    tx = get_transaction()

    try:
        resp = tx.commit(token)
    except Exception as e:
        try:
            donacion = Donacion.objects.get(token=token)
            donacion.estado = "ERROR"
            donacion.save(update_fields=["estado"])
        except Donacion.DoesNotExist:
            pass
        return HttpResponse(f"Error al confirmar pago: {e}", status=500)

    buy_order = resp.get("buy_order")
    status_tx = resp.get("status")            # 'AUTHORIZED', 'FAILED', etc.
    response_code = resp.get("response_code")  # 0 si OK

    try:
        donacion = Donacion.objects.get(token=token, orden_compra=buy_order)
    except Donacion.DoesNotExist:
        return HttpResponse("Donación no encontrada.", status=404)

    # Actualizar estado según Webpay
    if status_tx == "AUTHORIZED" and response_code == 0:
        donacion.estado = "APROBADA"
    else:
        donacion.estado = "RECHAZADA"
    donacion.save(update_fields=["estado"])

    # ==== URL del home (para redirigir) ====
    front_base = getattr(settings, "FRONTEND_BASE_URL", "").rstrip("/")
    if front_base:
        home_url = f"{front_base}/home"
    else:
        # fallback para desarrollo
        home_url = "http://localhost:8100/home"

    # ==== HTML bonito + contador ====
    estado = donacion.estado
    monto = donacion.monto
    es_ok = estado == "APROBADA"

    titulo = "¡Gracias por tu donación! 💛" if es_ok else "No se pudo completar la donación 😕"
    mensaje = (
        "Tu aporte ayuda a que Cambioteca siga creciendo y fomentando el intercambio de libros 📚."
        if es_ok
        else "La transacción fue rechazada o cancelada. Si quieres, puedes intentarlo nuevamente."
    )
    estado_texto = "Donación aprobada" if es_ok else "Donación rechazada"
    estado_clase = "ok" if es_ok else "bad"

    html = f"""
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <title>Cambioteca - Donación {estado}</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body {{
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
          background: #0f172a;
          color: #f9fafb;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
        }}
        .card {{
          background: #020617;
          border-radius: 18px;
          padding: 24px 20px;
          max-width: 380px;
          width: 100%;
          text-align: center;
          box-shadow: 0 24px 50px rgba(0,0,0,0.45);
        }}
        .logo {{
          font-weight: 700;
          letter-spacing: 0.08em;
          font-size: 0.9rem;
          text-transform: uppercase;
          color: #a5b4fc;
          margin-bottom: 6px;
        }}
        h1 {{
          font-size: 1.4rem;
          margin: 4px 0 10px;
        }}
        .estado {{
          margin-top: 8px;
          font-size: 0.95rem;
          font-weight: 600;
        }}
        .estado.ok {{ color: #4ade80; }}
        .estado.bad {{ color: #fb7185; }}
        .monto {{ margin-top: 8px; font-size: 1.05rem; color: #e5e7eb; }}
        p {{ font-size: 0.9rem; margin-top: 12px; color: #9ca3af; }}
        .btn {{
          display: inline-block;
          margin-top: 18px;
          padding: 10px 18px;
          border-radius: 999px;
          text-decoration: none;
          font-size: 0.9rem;
          font-weight: 500;
          background: #4f46e5;
          color: #f9fafb;
        }}
        .countdown {{
          margin-top: 10px;
          font-size: 0.85rem;
          color: #9ca3af;
        }}
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">CAMBIOTECA</div>
        <h1>{titulo}</h1>
        <div class="estado {estado_clase}">{estado_texto}</div>
        <div class="monto">Monto: <strong>{monto:,} CLP</strong></div>
        <p>{mensaje}</p>

        <a href="{home_url}" class="btn">Volver a Cambioteca</a>
        <div class="countdown">
          Serás redirigido al inicio en
          <span id="seconds">5</span> segundos…
        </div>
      </div>

      <script>
        (function() {{
          var seconds = 5;
          var span = document.getElementById('seconds');
          var url = "{home_url}";
          function tick() {{
            seconds -= 1;
            if (seconds <= 0) {{
              window.location.href = url;
            }} else {{
              span.textContent = seconds;
              setTimeout(tick, 1000);
            }}
          }}
          span.textContent = seconds;
          setTimeout(tick, 1000);
        }})();
      </script>
    </body>
    </html>
    """
    return HttpResponse(html)
