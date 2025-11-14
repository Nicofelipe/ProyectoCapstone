from rest_framework.permissions import BasePermission

class IsAdminUser(BasePermission):
    """
    Permiso personalizado para permitir solo a usuarios con es_admin=True.
    """
    message = "No tienes permisos de administrador para realizar esta acción."

    def has_permission(self, request, view):
        # request.user es el objeto Usuario (gracias a tu JWTAuthentication)
        return (
            request.user and
            request.user.is_authenticated and
            getattr(request.user, 'es_admin', False)
        )