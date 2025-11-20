import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule, HttpParams } from '@angular/common/http';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
    AlertController,
    IonicModule,
    ToastController,
} from '@ionic/angular';
import { environment } from 'src/environments/environment';

export interface AdminReportRow {
    id: number;              // el que usaremos en el front
    id_reporte?: number;     // viene desde el backend

    tipo: 'LIBRO' | 'USUARIO' | string;
    motivo: string;
    detalle?: string;
    estado: 'PENDIENTE' | 'EN_REVISION' | 'APROBADO' | 'RECHAZADO' | string;
     creado_en?: string;
    revisado_en?: string;

    // quién reporta
    reporter_id?: number;
    reporter_nombre?: string;
    reporter_email?: string;

    // libro reportado
    libro_id?: number;
    libro_titulo?: string;
    libro_owner_id?: number;
    libro_owner_nombre?: string;

    // usuario reportado
    usuario_reportado_id?: number;
    usuario_reportado_nombre?: string;
    usuario_reportado_email?: string;
}
@Component({
    selector: 'app-admin-reports',
    standalone: true,
    imports: [IonicModule, CommonModule, HttpClientModule, FormsModule],
    templateUrl: './admin-reports.page.html',
    styleUrls: ['./admin-reports.page.scss'],
})
export class AdminReportsPage implements OnInit {
    private _loading = signal(true);
    private _rows = signal<AdminReportRow[]>([]);

    loading = computed(() => this._loading());
    rows = computed(() => this._rows());

    search = '';
    filtroEstado: 'todos' | 'pendientes' | 'revisados' | 'descartados' = 'pendientes';

    // Base sin slash final
    private readonly BASE_URL = environment.apiUrl.replace(/\/+$/, '');

    // Raíz real de la API: garantiza que termine en ".../api"
    private get apiRoot(): string {
        return this.BASE_URL.endsWith('/api') ? this.BASE_URL : `${this.BASE_URL}/api`;
    }

    constructor(
        private http: HttpClient,
        private router: Router,
        private alertCtrl: AlertController,
        private toastCtrl: ToastController
    ) { }

    ngOnInit() {
        this.load();
    }

    // ================== CARGAR LISTA ==================
    load(ev?: any) {
        this._loading.set(true);
        let params = new HttpParams();

        if (this.search.trim()) {
            params = params.set('search', this.search.trim());
        }

        // Backend espera estado en mayúsculas
        if (this.filtroEstado === 'pendientes') {
            params = params.set('estado', 'PENDIENTE');
        } else if (this.filtroEstado === 'revisados') {
            params = params.set('estado', 'APROBADO');      // revisados = aprobados
        } else if (this.filtroEstado === 'descartados') {
            params = params.set('estado', 'RECHAZADO');     // descartados = rechazados
        }

        const url = `${this.apiRoot}/admin/reportes-publicacion/`;

        this.http.get<any[]>(url, { params }).subscribe({
            next: (rows) => {
                console.log('RAW reports:', rows);

                const normalizados: AdminReportRow[] = (rows || []).map((r: any, idx: number) => {
                    // ID del reporte (para /resolver/)
                    const idReporte =
                        r.id ??
                        r.id_reporte ??
                        r.reporte_id ??
                        null;

                    // ID del libro reportado (venía distinto en tu log)
                    const libroId =
                        r.libro_id ??
                        r.id_libro ??
                        r.id_libro_reportado ??
                        null;

                    // ID del usuario reportado
                    const usuarioReportadoId =
                        r.usuario_reportado_id ??
                        r.id_usuario_reportado ??
                        r.id_usuario ??
                        null;

                    // ID del reportante
                    const reporterId =
                        r.reporter_id ??
                        r.id_reporter ??
                        null;

                    return {
                        ...r,
                        id: idReporte != null ? Number(idReporte) : idx,   // <- ya no habrá "sin id"
                        libro_id: libroId != null ? Number(libroId) : undefined,
                        usuario_reportado_id: usuarioReportadoId != null ? Number(usuarioReportadoId) : undefined,
                        reporter_id: reporterId != null ? Number(reporterId) : undefined,
                    } as AdminReportRow;
                });

                this._rows.set(normalizados);
                this._loading.set(false);
                ev?.target?.complete();
            },
            error: (err) => {
                console.error('Error cargando reportes', err);
                this._loading.set(false);
                ev?.target?.complete();
                this.showToast('No se pudo cargar la lista de reportes.');
            },
        });
    }





    // ================== HELPERS VISUALES ==================
    estadoColor(r: AdminReportRow): 'warning' | 'success' | 'medium' | 'danger' {
        const e = (r.estado || '').toUpperCase();
        if (e === 'PENDIENTE') return 'warning';
        if (e === 'EN_REVISION') return 'medium';
        if (e === 'APROBADO') return 'success';
        if (e === 'RECHAZADO') return 'danger';
        return 'medium';
    }

    tipoTexto(r: AdminReportRow): string {
        const t = (r.tipo || '').toUpperCase();
        if (t === 'LIBRO') return 'Publicación';
        if (t === 'USUARIO') return 'Usuario';
        return r.tipo || 'Otro';
    }

    puedeResolver(r: AdminReportRow): boolean {
        const e = (r.estado || '').toUpperCase();
        return e === 'PENDIENTE' || e === 'EN_REVISION';
    }

    // ================== NAVEGACIÓN ==================
    irAlLibro(r: AdminReportRow) {
  if (!r.libro_id) return;

  this.router.navigate(['/books/view', r.libro_id], {
    queryParams: {
      admin: 1,
      from: 'admin-reports',
    },
  });
}

irAlUsuarioReportado(r: AdminReportRow) {
  // para reportes de LIBRO usamos el dueño como usuario reportado
  const uid = r.usuario_reportado_id || r.libro_owner_id;
  if (!uid) return;

  this.router.navigate(['/users', uid], {
    state: { from: 'admin-reports' },
  });
}

    irAlReportante(r: AdminReportRow) {
        if (!r.reporter_id) return;
        this.router.navigate(['/users', r.reporter_id]);
    }

    // ================== ACCIONES ==================
    async confirmarMarcarRevisado(r: AdminReportRow) {
        if (!this.puedeResolver(r)) return;

        const alert = await this.alertCtrl.create({
            header: 'Marcar como revisado',
            message: '¿Confirmas que este reporte ya fue revisado (aprobado)?',
            buttons: [
                { text: 'Cancelar', role: 'cancel' },
                { text: 'Marcar revisado', role: 'confirm' },
            ],
        });

        await alert.present();
        const { role } = await alert.onDidDismiss();
        if (role !== 'confirm') return;

        this.marcarRevisado(r);
    }

    private buildResolverUrl(r: AdminReportRow): string {
        const id = r.id as number | undefined;

        if (id == null) {
            console.error('Reporte sin id, no puedo armar URL', r);
            throw new Error('Reporte sin id');
        }

        // ✅ /api/admin/reportes-publicacion/<id>/resolver/
        return `${this.apiRoot}/admin/reportes-publicacion/${id}/resolver/`;
    }

    private marcarRevisado(r: AdminReportRow) {
        let url: string;
        try {
            url = this.buildResolverUrl(r);
        } catch {
            this.showToast('Reporte inválido (sin id).');
            return;
        }

        this.http.patch<{ estado?: string }>(url, {
            estado: 'APROBADO',
        }).subscribe({
            next: (res) => {
                const updated = this.rows().map((row) =>
                    row.id === r.id ? { ...row, estado: res.estado || 'APROBADO' } : row
                );
                this._rows.set(updated);
                this.showToast('Reporte marcado como revisado.');
            },
            error: (err) => {
                console.error('resolver (APROBADO) error', err);
                this.showToast('No se pudo marcar el reporte como revisado.');
            },
        });
    }

    async confirmarDescartar(r: AdminReportRow) {
        if (!this.puedeResolver(r)) return;

        const alert = await this.alertCtrl.create({
            header: 'Descartar reporte',
            message:
                '¿Seguro que quieres descartar este reporte? No se mostrará como pendiente.',
            buttons: [
                { text: 'Cancelar', role: 'cancel' },
                { text: 'Descartar', role: 'destructive' },
            ],
        });

        await alert.present();
        const { role } = await alert.onDidDismiss();
        if (role !== 'destructive') return;

        this.descartar(r);
    }

    private descartar(r: AdminReportRow) {
        let url: string;
        try {
            url = this.buildResolverUrl(r);
        } catch {
            this.showToast('Reporte inválido (sin id).');
            return;
        }

        this.http.patch<{ estado?: string }>(url, {
            estado: 'RECHAZADO',
        }).subscribe({
            next: (res) => {
                const updated = this.rows().map((row) =>
                    row.id === r.id ? { ...row, estado: res.estado || 'RECHAZADO' } : row
                );
                this._rows.set(updated);
                this.showToast('Reporte descartado.');
            },
            error: (err) => {
                console.error('resolver (RECHAZADO) error', err);
                this.showToast('No se pudo descartar el reporte.');
            },
        });
    }

    // ================== UI helpers ==================
    async showToast(message: string) {
        const toast = await this.toastCtrl.create({
            message,
            duration: 2500,
            position: 'bottom',
        });
        await toast.present();
    }

    onSearchChange() {
        this.load();
    }

    onFilterChange() {
        this.load();
    }

    doRefresh(ev: any) {
        this.load(ev);
    }



}
