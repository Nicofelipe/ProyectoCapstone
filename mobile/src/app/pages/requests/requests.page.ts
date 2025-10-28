import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  AlertController,
  IonicModule,
  ToastController
} from '@ionic/angular';

import { AuthService, MeUser } from 'src/app/core/services/auth.service';
import { IntercambiosService } from 'src/app/core/services/intercambios.service';

type UsuarioLite = { id_usuario: number; nombre_usuario: string | null };
type LibroLite = { id_libro: number; titulo: string; autor?: string | null };

export type OfertaLite = { id_oferta: number; libro_ofrecido: LibroLite };
export type SolicitudDTO = {
  id_solicitud: number;
  estado: string;
  creada_en?: string | null;
  actualizada_en?: string | null;
  solicitante: UsuarioLite;
  receptor: UsuarioLite;
  libro_deseado: LibroLite;
  ofertas: OfertaLite[];
  libro_aceptado?: LibroLite | null;
  chat_enabled?: boolean;
  intercambio_id?: number | null;
  conversacion_id?: number | null;
  lugar_intercambio?: string | null;
  fecha_intercambio_pactada?: string | null;
  fecha_completado?: string | null;
};

@Component({
  selector: 'app-requests',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './requests.page.html',
  styleUrls: ['./requests.page.scss'],
})
export class RequestsPage implements OnInit {
  me: MeUser | null = null;

  tab = signal<'recibidas' | 'enviadas'>('recibidas');
  loading = signal(true);
  recibidas = signal<SolicitudDTO[]>([]);
  enviadas = signal<SolicitudDTO[]>([]);

  constructor(
    private auth: AuthService,
    private svc: IntercambiosService,
    private router: Router,
    private toast: ToastController,
    private alert: AlertController,
  ) { }

  private liveTimer: any = null;
  private readonly LIVE_MS = 4000;

  async ngOnInit() {
    await this.auth.restoreSession();
    this.me = this.auth.user;
    if (!this.me) { this.router.navigateByUrl('/auth/login'); return; }
    await this.load();
    this.startLive(); // ⬅️ arranca auto-actualización
  }

  ngOnDestroy(): void {
    this.stopLive(); // ⬅️ limpia timer
  }

  async load() {
    if (!this.me) return;
    this.loading.set(true);
    try {
      const [rec, env] = await Promise.all([
        this.svc.listarRecibidas(this.me.id).toPromise() as Promise<SolicitudDTO[]>,
        this.svc.listarEnviadas(this.me.id).toPromise() as Promise<SolicitudDTO[]>,
      ]);
      this.recibidas.set(rec || []);
      this.enviadas.set(env || []);
    } catch (e: any) {
      const t = await this.toast.create({ message: e?.error?.detail || 'No se pudieron cargar las solicitudes', duration: 1600 });
      t.present();
    } finally {
      this.loading.set(false);
    }
  }

  private async refreshSilently() {
    if (!this.me) return;
    try {
      const [rec, env] = await Promise.all([
        this.svc.listarRecibidas(this.me.id).toPromise() as Promise<SolicitudDTO[]>,
        this.svc.listarEnviadas(this.me.id).toPromise() as Promise<SolicitudDTO[]>,
      ]);
      this.recibidas.set(rec || []);
      this.enviadas.set(env || []);
    } catch {
      /* silencioso */
    }
  }

  private startLive() {
    this.stopLive();
    this.liveTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return; // pausa en background
      this.refreshSilently();
    }, this.LIVE_MS);
  }

  private stopLive() {
    if (this.liveTimer) {
      clearInterval(this.liveTimer);
      this.liveTimer = null;
    }
  }

  colorEstado(est: string) {
    const s = (est || '').toLowerCase();
    if (s === 'pendiente') return 'warning';
    if (s === 'aceptada') return 'primary';
    if (s === 'rechazada' || s === 'cancelada') return 'danger';
    return 'medium';
  }

  goDetail(row: SolicitudDTO) {
    this.router.navigate(['/requests', row.id_solicitud]);
  }

  showChat(row: SolicitudDTO) {
    return !!row.conversacion_id && (row.estado || '').toLowerCase() === 'aceptada';
  }

  openChat(row: SolicitudDTO, ev?: Event) {
    ev?.stopPropagation();
    if (!row.conversacion_id) return;
    // Ajusta a tu ruta real de chat (si usas otra):
    this.router.navigate(['/chats', row.conversacion_id]);
  }

  // Texto auxiliar por rol
  counterpartyName(row: SolicitudDTO, rol: 'recibida' | 'enviada') {
    const u = rol === 'recibida' ? row.solicitante : row.receptor;
    return u?.nombre_usuario || '—';
  }

  ofertasCount = (row: SolicitudDTO) => (row.ofertas?.length || 0);
}
