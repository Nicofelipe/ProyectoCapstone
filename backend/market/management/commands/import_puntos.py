from django.core.management.base import BaseCommand
from market.models import PuntoEncuentro  # ajusta el import al app correcto
import csv, os

HEADERS = {
    "name": ["name","nombre","sede","estacion","título","titulo"],
    "addr": ["address","direccion","dirección","addr"],
    "lat":  ["lat","latitude","latitud"],
    "lon":  ["lng","lon","long","longitud"],
}

def pick(d, keys):
    for k in keys:
        if k in d and d[k]:
            return d[k]
    return None

class Command(BaseCommand):
    help = "Importa puntos de encuentro desde uno o más CSV (requiere lat/lon)."

    def add_arguments(self, parser):
        parser.add_argument('csvs', nargs='+', help='Rutas a CSV')

    def handle(self, *args, **opts):
        tot=crt=upd=sk=0
        for path in opts['csvs']:
            if not os.path.exists(path):
                self.stdout.write(self.style.WARNING(f"Archivo no existe: {path}"))
                continue
            with open(path, encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    nom = pick(row, HEADERS["name"]) or "Punto"
                    adr = pick(row, HEADERS["addr"]) or ""
                    lat = pick(row, HEADERS["lat"])
                    lon = pick(row, HEADERS["lon"])
                    try:
                        lat = float(str(lat).replace(",", "."))
                        lon = float(str(lon).replace(",", "."))
                    except Exception:
                        sk += 1; continue

                    obj, created = PuntoEncuentro.objects.update_or_create(
                        latitud=lat, longitud=lon,
                        defaults={
                            "nombre": nom[:120],
                            "direccion": adr[:200],
                            "tipo": "PUBLICO",
                            "habilitado": True,
                        }
                    )
                    tot += 1
                    if created: crt += 1
                    else: upd += 1
        self.stdout.write(self.style.SUCCESS(
            f"Procesados={tot}  creados={crt}  actualizados={upd}  omitidos={sk}"
        ))