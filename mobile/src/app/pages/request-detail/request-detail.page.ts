import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
    AlertController,
    IonicModule,
    ToastController
} from '@ionic/angular';

import { AuthService, MeUser } from 'src/app/core/services/auth.service';
import { IntercambiosService } from 'src/app/core/services/intercambios.service';

type UsuarioLite = { id_usuario: number; nombre_usuario: string | null };
type LibroLite = { id_libro: number; titulo: string; autor?: string | null };
type OfertaLite = { id_oferta: number; libro_ofrecido: LibroLite };

type SolicitudDTO = {
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
    selector: 'app-request-detail',
    standalone: true,
    imports: [CommonModule, IonicModule, FormsModule],
    templateUrl: './request-detail.page.html',
    styleUrls: ['./request-detail.page.scss'],
})
export class RequestDetailPage implements OnInit {
    me: MeUser | null = null;

    loading = signal(true);
    row = signal<SolicitudDTO | null>(null);
    // derivadas
    estado = computed(() => (this.row()?.estado || '').toLowerCase());
    esPendiente = computed(() => this.estado() === 'pendiente');
    esAceptada = computed(() => this.estado() === 'aceptada');

    private liveTimer: any = null;
    private readonly LIVE_MS = 4000;
    private currentId = 0;

    // rol: 'recibida' (ofreciente) o 'enviada' (solicitante)
    rol = computed<'recibida' | 'enviada'>(() => {
        const r = this.row();
        if (!r || !this.me) return 'enviada';
        return r.receptor?.id_usuario === this.me.id ? 'recibida' : 'enviada';
    });

    // reunión
    lugar = signal('');
    fecha = signal(''); // para <input type="datetime-local">
    // código
    codigoGenerado = signal<string | null>(null);
    codigoIngresado = signal('');
    estaCompletado = computed(() => !!this.row()?.fecha_completado);
    puedeCalificar = computed(() => this.estaCompletado());

    constructor(
        private route: ActivatedRoute,
        private router: Router,
        private auth: AuthService,
        private svc: IntercambiosService,
        private toast: ToastController,
        private alert: AlertController,
    ) { }

    async ngOnInit() {
        await this.auth.restoreSession();
        this.me = this.auth.user;
        if (!this.me) { this.router.navigateByUrl('/auth/login'); return; }

        const id = Number(this.route.snapshot.paramMap.get('id'));
        if (!id) { this.router.navigateByUrl('/requests'); return; }
        this.currentId = id;
        await this.load(id);
        this.startLive(); // ⬅️ comienza auto-actualización del detalle
    }

    ngOnDestroy(): void {
        this.stopLive(); // ⬅️ limpia timer
    }

    async load(id: number) {
        this.loading.set(true);
        try {
            const [rec, env] = await Promise.all([
                this.svc.listarRecibidas(this.me!.id).toPromise() as Promise<SolicitudDTO[]>,
                this.svc.listarEnviadas(this.me!.id).toPromise() as Promise<SolicitudDTO[]>,
            ]);
            const found = [...(rec || []), ...(env || [])].find(x => x.id_solicitud === id) || null;
            this.row.set(found);

            // precarga valores de reunión si los hay (solo en carga inicial)
            const d = found;
            if (d?.lugar_intercambio) this.lugar.set(d.lugar_intercambio);
            if (d?.fecha_intercambio_pactada) {
                const iso = new Date(d.fecha_intercambio_pactada).toISOString().slice(0, 16);
                this.fecha.set(iso);
            }
        } catch (e: any) {
            (await this.toast.create({ message: e?.error?.detail || 'Error cargando solicitud', duration: 1600 })).present();
        } finally {
            this.loading.set(false);
        }
    }

    // ⬇️ NUEVO: refresco sin spinner y sin pisar inputs
    private async refreshSilently() {
        if (!this.me || !this.currentId) return;
        try {
            const [rec, env] = await Promise.all([
                this.svc.listarRecibidas(this.me.id).toPromise() as Promise<SolicitudDTO[]>,
                this.svc.listarEnviadas(this.me.id).toPromise() as Promise<SolicitudDTO[]>,
            ]);
            const found = [...(rec || []), ...(env || [])].find(x => x.id_solicitud === this.currentId) || null;
            this.row.set(found);
            // OJO: NO actualizamos this.lugar/this.fecha aquí para no pisar lo que el usuario edita
        } catch {
            /* silencioso */
        }
    }

    private startLive() {
        this.stopLive();
        this.liveTimer = setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            this.refreshSilently();
        }, this.LIVE_MS);
    }

    private stopLive() {
        if (this.liveTimer) {
            clearInterval(this.liveTimer);
            this.liveTimer = null;
        }
    }


    offeredId(o: any) {
        return o?.libro_ofrecido?.id_libro
            ?? o?.id_libro_ofrecido?.id_libro
            ?? o?.id_libro_ofrecido_id
            ?? o?.id_libro_ofrecido
            ?? null;
    }
    offeredTitle(o: any) {
        return o?.libro_ofrecido?.titulo
            ?? o?.id_libro_ofrecido?.titulo
            ?? 'Libro';
    }

    colorEstado(est?: string | null) {
        const s = (est || '').toLowerCase();
        if (s === 'pendiente') return 'warning';
        if (s === 'aceptada') return 'primary';
        if (s === 'rechazada' || s === 'cancelada') return 'danger';
        return 'medium';
    }

    // === Acciones ===
    async aceptar(idLibro: number | string | null | undefined) {
        const s = this.row(); if (!s || !this.me || idLibro == null) return;
        const libroId = Number(idLibro);   // 👈 fuerza número
        if (Number.isNaN(libroId)) {
            (await this.toast.create({ message: 'Libro inválido', duration: 1200, color: 'danger' })).present();
            return;
        }
        try {
            await this.svc.aceptarSolicitud(s.id_solicitud, this.me.id, libroId).toPromise();
            (await this.toast.create({ message: 'Solicitud aceptada', duration: 1400, color: 'success' })).present();
            await this.load(s.id_solicitud);
        } catch (e: any) {
            (await this.toast.create({ message: e?.error?.detail || 'No se pudo aceptar', duration: 1600, color: 'danger' })).present();
        }
    }

    async rechazar() {
        const s = this.row(); if (!s || !this.me) return;
        const al = await this.alert.create({
            header: 'Rechazar solicitud',
            message: '¿Seguro que deseas rechazarla?',
            buttons: [
                { text: 'Cancelar', role: 'cancel' },
                {
                    text: 'Rechazar', role: 'destructive', handler: async () => {
                        try {
                            await this.svc.rechazarSolicitud(s.id_solicitud, this.me!.id).toPromise();
                            (await this.toast.create({ message: 'Solicitud rechazada', duration: 1400 })).present();
                            this.router.navigateByUrl('/requests', { replaceUrl: true });
                        } catch (e: any) {
                            (await this.toast.create({ message: e?.error?.detail || 'No se pudo rechazar', duration: 1600, color: 'danger' })).present();
                        }
                    }
                }
            ]
        });
        await al.present();
    }

    async cancelar() {
        const s = this.row(); if (!s || !this.me) return;
        const al = await this.alert.create({
            header: 'Cancelar solicitud',
            message: 'Esto cancelará tu solicitud pendiente.',
            buttons: [
                { text: 'No', role: 'cancel' },
                {
                    text: 'Sí, cancelar', role: 'destructive', handler: async () => {
                        try {
                            await this.svc.cancelarSolicitud(s.id_solicitud, this.me!.id).toPromise();
                            (await this.toast.create({ message: 'Solicitud cancelada', duration: 1400 })).present();
                            this.router.navigateByUrl('/requests', { replaceUrl: true });
                        } catch (e: any) {
                            (await this.toast.create({ message: e?.error?.detail || 'No se pudo cancelar', duration: 1600, color: 'danger' })).present();
                        }
                    }
                }
            ]
        });
        await al.present();
    }

    // proponer(): requiere campos y pide confirmación
    async proponer() {
        const s = this.row(); if (!s || !this.me || !s.intercambio_id) return;

        const lugar = (this.lugar() || '').trim();
        const fecha = (this.fecha() || '').trim();
        if (!lugar || !fecha) {
            (await this.toast.create({ message: 'Debes ingresar lugar y fecha/hora.', duration: 1600, color: 'warning' })).present();
            return;
        }

        const al = await this.alert.create({
            header: 'Confirmar propuesta',
            message: `¿Seguro que esta es la fecha/hora y lugar del encuentro?<br><b>${lugar}</b><br>${new Date(fecha).toLocaleString()}`,
            buttons: [
                { text: 'Volver', role: 'cancel' },
                {
                    text: 'Confirmar', role: 'confirm', handler: async () => {
                        try {
                            await this.svc.proponerEncuentro(
                                s.intercambio_id!, this.me!.id, lugar, new Date(fecha).toISOString()
                            ).toPromise();
                            (await this.toast.create({ message: 'Propuesta enviada', duration: 1400 })).present();
                            await this.load(s.id_solicitud);
                        } catch (e: any) {
                            (await this.toast.create({ message: e?.error?.detail || 'No se pudo proponer', duration: 1600, color: 'danger' })).present();
                        }
                    }
                }
            ]
        });
        await al.present();
    }

    // NUEVO: calificar contraparte
    async calificar() {
        const s = this.row(); if (!s || !this.me || !s.intercambio_id) return;

        const al = await this.alert.create({
            header: 'Calificar usuario',
            inputs: [
                { name: 'rating', type: 'radio', label: '⭐ 1', value: 1 },
                { name: 'rating', type: 'radio', label: '⭐⭐ 2', value: 2 },
                { name: 'rating', type: 'radio', label: '⭐⭐⭐ 3', value: 3, checked: true },
                { name: 'rating', type: 'radio', label: '⭐⭐⭐⭐ 4', value: 4 },
                { name: 'rating', type: 'radio', label: '⭐⭐⭐⭐⭐ 5', value: 5 },
                { name: 'comentario', type: 'textarea', placeholder: 'Comentario (opcional)' }
            ],
            buttons: [
                { text: 'Cancelar', role: 'cancel' },
                {
                    text: 'Enviar', role: 'confirm', handler: async (data: any) => {
                        // Ionic retorna un objeto con los inputs cuando usan 'name'
                        const puntuacion = Number(data?.rating ?? 3);
                        const comentario = String(data?.comentario ?? '').trim();
                        try {
                            await this.svc.calificar(s.intercambio_id!, this.me!.id, puntuacion, comentario).toPromise();
                            (await this.toast.create({ message: '¡Gracias por calificar!', duration: 1500, color: 'success' })).present();
                        } catch (e: any) {
                            (await this.toast.create({ message: e?.error?.detail || 'No se pudo calificar', duration: 1600, color: 'danger' })).present();
                        }
                    }
                }
            ]
        });

        await al.present();
    }

    async confirmar() {
        const s = this.row(); if (!s || !this.me || !s.intercambio_id) return;

        const al = await this.alert.create({
            header: 'Confirmar reunión',
            message: `¿Estás seguro de confirmar el lugar/fecha propuestos?`,
            buttons: [
                { text: 'Cancelar', role: 'cancel' },
                {
                    text: 'Confirmar', role: 'confirm', handler: async () => {
                        try {
                            await this.svc.confirmarEncuentro(s.intercambio_id!, this.me!.id, true).toPromise();
                            (await this.toast.create({ message: 'Reunión confirmada', duration: 1400, color: 'success' })).present();
                        } catch (e: any) {
                            (await this.toast.create({ message: e?.error?.detail || 'No se pudo confirmar', duration: 1600, color: 'danger' })).present();
                        }
                    }
                }
            ]
        });
        await al.present();
    }

    async generarCodigo() {
        const s = this.row(); if (!s || !this.me || !s.intercambio_id) return;
        try {
            const r: any = await this.svc.generarCodigo(s.intercambio_id, this.me.id).toPromise();
            this.codigoGenerado.set(r?.codigo || null);
            (await this.toast.create({ message: 'Código generado', duration: 1300 })).present();
        } catch (e: any) {
            (await this.toast.create({ message: e?.error?.detail || 'No se pudo generar', duration: 1600, color: 'danger' })).present();
        }
    }

    async completar() {
        const row = this.row(); if (!row || !this.me || !row.intercambio_id) return;
        const code = (this.codigoIngresado() || '').trim().toUpperCase();
        if (!code) return;

        try {
            await this.svc.completarConCodigo(row.intercambio_id, this.me.id, code).toPromise();
            (await this.toast.create({ message: '¡Intercambio completado!', duration: 1500, color: 'success' })).present();
            await this.load(row.id_solicitud);
        } catch (e: any) {
            console.error('Completar error:', e?.error); // mira el detail exacto del backend
            const msg = e?.error?.detail || e?.error?.codigo?.[0] || 'No se pudo completar el intercambio.';
            (await this.toast.create({ message: msg, duration: 1800, color: 'danger' })).present();
        }
    }

    // --- estado del modal de calificación
    ratingOpen = signal(false);
    ratingVal = signal(3);
    ratingComment = signal('');
    yaCalifique = signal(false); // oculta botón tras calificar (o si backend devuelve 409)

    openRating() {
        this.ratingVal.set(3);
        this.ratingComment.set('');
        this.ratingOpen.set(true);
    }

    async confirmRating() {
        const s = this.row(); if (!s || !this.me || !s.intercambio_id) return;

        try {
            await this.svc.calificar(s.intercambio_id, this.me.id, this.ratingVal(), this.ratingComment()).toPromise();
            this.yaCalifique.set(true);
            this.ratingOpen.set(false);
            (await this.toast.create({ message: '¡Gracias por calificar!', duration: 1500, color: 'success' })).present();
        } catch (e: any) {
            const msg = e?.error?.detail || 'No se pudo calificar';
            if ((msg + '').toLowerCase().includes('ya calificaste')) {
                this.yaCalifique.set(true);
                this.ratingOpen.set(false);
            }
            (await this.toast.create({ message: msg, duration: 1700, color: 'danger' })).present();
        }
    }

    // request-detail.page.ts
    goUser(uid: number | null | undefined) {
        if (!uid) return;
        this.router.navigate(['/users', uid], { state: { from: this.router.url } });
    }


    goChat() {
        const s = this.row();
        if (s?.conversacion_id) this.router.navigate(['/chats', s.conversacion_id]); // ajusta si tu ruta difiere
    }

    // permisos por rol/estado
    puedeAceptar = computed(() => this.rol() === 'recibida' && this.esPendiente());
    puedeRechazar = computed(() => this.rol() === 'recibida' && this.esPendiente());
    puedeCancelar = computed(() => this.rol() === 'enviada' && this.esPendiente());

    reunionVisible = computed(() => this.esAceptada());
    puedeProponer = computed(() => this.rol() === 'recibida' && this.esAceptada());
    puedeConfirmar = computed(() => this.rol() === 'enviada' && this.esAceptada());

    puedeGenerar = computed(() => this.rol() === 'recibida' && this.esAceptada());
    puedeIngresar = computed(() => this.rol() === 'enviada' && this.esAceptada());
}


