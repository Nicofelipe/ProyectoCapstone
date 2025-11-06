"""
Django settings for api project.
"""

from pathlib import Path
import os
from datetime import timedelta
from dotenv import load_dotenv

# --- Paths / .env ---
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")

def env_list(name: str, default: str = ""):
    val = os.getenv(name, default)
    return [x.strip() for x in val.split(",") if x.strip()]

# --- Seguridad / Core ---
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret")
DEBUG = os.getenv("DEBUG", "True") == "True"
# Sugerido en Railway: ALLOWED_HOSTS=".up.railway.app"
ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "127.0.0.1,localhost")



# Si estás detrás de un proxy (Railway) que termina TLS:
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
USE_X_FORWARDED_HOST = True

# Cookies seguras (opcional, recomendado en prod)
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# --- Apps ---
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    # apps propias
    "core",
    "market",
]

# --- Middleware (WhiteNoise inmediatamente tras Security) ---
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "api.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "api.wsgi.application"

# --- Base de datos (Railway + Local) ---
RAILWAY_INTERNAL = bool(
    os.getenv("RAILWAY") or
    os.getenv("RAILWAY_ENVIRONMENT") or
    os.getenv("RAILWAY_STATIC_URL")
)

DB_NAME = os.getenv("DB_NAME") or os.getenv("MYSQLDATABASE") or "cambioteca"
DB_USER = os.getenv("DB_USER") or os.getenv("MYSQLUSER") or "cambiouser"
DB_PASSWORD = (
    os.getenv("DB_PASSWORD")
    or os.getenv("MYSQLPASSWORD")
    or os.getenv("MYSQL_ROOT_PASSWORD")
    or ""
)

# Si no defines DB_HOST/DB_PORT:
#   - dentro de Railway usa red interna
#   - en local usa proxy público
DB_HOST = os.getenv("DB_HOST") or ("mysql.railway.internal" if RAILWAY_INTERNAL else "tramway.proxy.rlwy.net")
DB_PORT = os.getenv("DB_PORT") or ("3306" if RAILWAY_INTERNAL else "25415")

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.mysql",
        "NAME": DB_NAME,
        "USER": DB_USER,
        "PASSWORD": DB_PASSWORD,
        "HOST": DB_HOST,
        "PORT": str(DB_PORT),
        "OPTIONS": {
            "charset": "utf8mb4",
            "init_command": "SET SESSION sql_mode='STRICT_TRANS_TABLES'",
            # "ssl": {"require": True},  # si lo necesitas
        },
        "CONN_MAX_AGE": int(os.getenv("DB_CONN_MAX_AGE", "60")),
    }
}




# --- Password validators ---
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# --- Internacionalización ---
LANGUAGE_CODE = "es"
TIME_ZONE = "America/Santiago"
USE_I18N = True
USE_TZ = True

# --- Static & Media ---
STATIC_URL = "static/"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_ROOT = BASE_DIR / "staticfiles"
if not DEBUG:
    STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

MEDIA_URL = os.getenv(
    "MEDIA_URL",
    "https://proyectocapstone-production.up.railway.app/media/"
)
MEDIA_ROOT = os.path.join(BASE_DIR, "media") 

# --- CORS / CSRF ---
# En producción agrega tu dominio Railway en variables:
# CORS_ALLOWED_ORIGINS=https://tu-servicio.up.railway.app
# CSRF_TRUSTED_ORIGINS=https://tu-servicio.up.railway.app
CORS_ALLOWED_ORIGINS = env_list(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:8100,http://127.0.0.1:8100"
)
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = env_list(
    "CSRF_TRUSTED_ORIGINS",
    "http://localhost:8100,http://127.0.0.1:8100"
)

# --- DRF / Auth ---
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "core.authentication.UsuarioJWTAuthentication", 
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(days=1),
    "USER_ID_FIELD": "id_usuario",
    "USER_ID_CLAIM": "user_id",
    "AUTH_HEADER_TYPES": ("Bearer",),
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Email (Gmail) ---
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = os.getenv("EMAIL_HOST", "smtp.gmail.com")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "465"))
EMAIL_USE_TLS = os.getenv("EMAIL_USE_TLS", "False") == "True"
EMAIL_USE_SSL = os.getenv("EMAIL_USE_SSL", "True") == "True"
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")            
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")    

# 👇 fallback robusto: si DEFAULT_FROM_EMAIL está vacío, usa EMAIL_HOST_USER; si también está vacío, usa uno de emergencia
DEFAULT_FROM_EMAIL = (
    os.getenv("DEFAULT_FROM_EMAIL")
    or EMAIL_HOST_USER
    or "cambioteca.cl@gmail.com"
)

FRONTEND_RESET_URL = os.getenv("FRONTEND_RESET_URL", "https://proyectocapstone-production.up.railway.app/auth/reset-password")
