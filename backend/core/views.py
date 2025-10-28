from django.conf import settings
from django.utils import timezone
from django.core.files.storage import default_storage
from django.core.mail import EmailMultiAlternatives
from email.mime.image import MIMEImage
from django.contrib.auth.hashers import check_password
from django.db.models import Q, Avg, Count

from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser

from .models import PasswordResetToken, Usuario, Region, Comuna
from .serializers import (
    RegisterSerializer, RegionSerializer, ComunaSerializer,
    ForgotPasswordSerializer, ResetPasswordSerializer,
    UsuarioLiteSerializer, UsuarioSummarySerializer
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
    Dada una ruta relativa en MEDIA (p.ej. 'avatars/xx.jpg') devuelve URL absoluta.
    Si ya viene absoluta (http/https), la retorna tal cual.
    """
    if not rel_path:
        rel_path = ''
    if str(rel_path).startswith('http://') or str(rel_path).startswith('https://'):
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
    Guarda el archivo en MEDIA_ROOT/avatars/<uuid>.<ext> y devuelve la ruta relativa
    (por ejemplo: 'avatars/2f3c...b.jpg').
    """
    try:
        file_obj.seek(0)
    except Exception:
        pass

    original = getattr(file_obj, "name", "avatar")
    ext = os.path.splitext(original)[1].lower() or ".jpg"
    rel_path = f"avatars/{uuid.uuid4().hex}{ext}"

    # Crea carpeta si no existe (FS local)
    try:
        base_str = str(settings.MEDIA_ROOT)
        os.makedirs(os.path.join(base_str, "avatars"), exist_ok=True)
    except Exception:
        pass

    saved_rel = default_storage.save(rel_path, file_obj)
    return str(saved_rel).replace("\\", "/")

# =========================
# LOGIN
# =========================
@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
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
# CATÁLOGO
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

    if user:
        token = secrets.token_urlsafe(48)
        PasswordResetToken.objects.create(user=user, token=token)
        reset_link = f"{settings.FRONTEND_RESET_URL}/{token}"

        subject = "Restablece tu contraseña - Cambioteca"
        from_email = getattr(settings, 'DEFAULT_FROM_EMAIL', 'no-reply@cambioteca.local')
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

        # Adjuntar logo si existe
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

        msg.send(fail_silently=False)

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
# Perfil
# =========================
@api_view(["GET"])
@permission_classes([AllowAny])
def user_profile_view(request, user_id: int):
    user = Usuario.objects.filter(id_usuario=user_id).first()
    if not user:
        return Response({"detail": "Usuario no encontrado."}, status=404)

    # === CAMBIO: sólo libros disponibles del usuario
    libros_count = Libro.objects.filter(id_usuario_id=user_id, disponible=True).count()

    # === CAMBIO: sólo intercambios Completados donde participó
    intercambios_count = Intercambio.objects.filter(
    estado_intercambio='Completado',
    id_solicitud__id_usuario_solicitante_id=user_id
    ).count() + Intercambio.objects.filter(
        estado_intercambio='Completado',
        id_solicitud__id_usuario_receptor_id=user_id
    ).count()

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
    from django.db.models import Q
    # imports locales para no tocar los de arriba
    from market.models import Intercambio, ImagenLibro, Conversacion

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

        # ✅ roles correctos:
        # - solicitante = quien creó la solicitud (y ofreció el libro aceptado)
        # - ofreciente  = el mismo solicitante (dueño del libro ofrecido aceptado)
        # - solicitado  = usuario receptor (dueño del libro deseado)
        solicitante_nombre = getattr(si.id_usuario_solicitante, 'nombre_usuario', None)
        solicitado_nombre  = getattr(si.id_usuario_receptor,   'nombre_usuario', None)

        ld = si.id_libro_deseado
        lo = i.id_libro_ofrecido_aceptado

        # Conversación del intercambio (si existe)
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
            "ofreciente": solicitante_nombre,   # 👈 antes estaba invertido
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
            "conversacion_id": getattr(conv, "id_conversacion", None),  # para que el chat aparezca abajo
        })

    return Response(out)

@api_view(["POST"])
@permission_classes([AllowAny])
def change_password_view(request):
    """
    Body: { "user_id": 123, "current": "...", "new": "..." }
    """
    from django.contrib.auth.hashers import check_password, make_password

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

@api_view(["GET"])
@permission_classes([AllowAny])
def user_summary(request, id: int):
    u = Usuario.objects.filter(pk=id, activo=True).select_related('comuna').first()
    if not u:
        return Response({"detail": "Usuario no encontrado"}, status=404)

    if u.imagen_perfil:
        u.imagen_perfil = u.imagen_perfil.replace("\\", "/")

    # === CAMBIO: contar sólo libros disponibles
    libros = Libro.objects.filter(id_usuario=id, disponible=True).count()

    # === CAMBIO: contar sólo intercambios Completados
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

    user_payload = {
        "id_usuario": u.id_usuario,
        "email": u.email,
        "nombres": u.nombres,
        "apellido_paterno": u.apellido_paterno,
        "apellido_materno": u.apellido_materno,
        "nombre_usuario": u.nombre_usuario,
        "imagen_perfil": u.imagen_perfil,
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

EDITABLE_FIELDS = {
    "nombres", "apellido_paterno", "apellido_materno",
    "telefono", "direccion", "numeracion"
}

@api_view(["PATCH"])
@permission_classes([AllowAny])  # cambia a IsAuthenticated cuando habilites auth real
def update_user_profile(request, id: int):
    u = Usuario.objects.filter(pk=id, activo=True).first()
    if not u:
        return Response({"detail": "Usuario no encontrado"}, status=404)

    updatable = ["nombres", "apellido_paterno", "apellido_materno", "telefono", "direccion", "numeracion"]
    for f in updatable:
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

# ========= Subir / Cambiar Avatar =========
@api_view(["PATCH"])
@permission_classes([AllowAny])  # cambia a IsAuthenticated si ya manejas auth real
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
        return Response({"imagen_perfil": rel}, status=200)
    except Exception as e:
        return Response({"detail": f"No se pudo guardar: {e}"}, status=400)

@api_view(["GET"])
@permission_classes([AllowAny])
def user_books_view(request, user_id: int):
    from market.models import Libro, ImagenLibro

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