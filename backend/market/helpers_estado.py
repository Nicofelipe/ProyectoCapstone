# helpers_estado.py (o dentro de views si prefieres)
from django.utils import timezone
from .constants import STATUS_REASON
from .models import Libro

def set_owner_unavailable(libro: Libro, flag: bool):
    """
    Dueño desactiva/reactiva su anuncio.
    - OWNER: el dueño puede activar/desactivar.
    - BAJA/COMPLETADO: el dueño NO puede reactivar.
    """
    current = (libro.status_reason or "").upper() if getattr(libro, "status_reason", None) else None

    if flag:
        # desactivar por dueño
        libro.disponible = False
        libro.status_reason = STATUS_REASON["OWNER"]
    else:
        # reactivar SOLO si fue OWNER o estaba sin motivo
        if current in (None, "", STATUS_REASON["OWNER"]):
            libro.disponible = True
            libro.status_reason = None
        else:
            # Si estaba BAJA/COMPLETADO, no cambies nada
            return
    libro.save(update_fields=["disponible", "status_reason"])
