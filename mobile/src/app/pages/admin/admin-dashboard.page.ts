// src/app/pages/admin-dashboard/admin-dashboard.page.ts
import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { Component, OnInit, computed, signal } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { environment } from 'src/environments/environment';

import {
    Chart,
    ChartConfiguration,
    ChartOptions,
    ChartType,
    registerables,
} from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';

Chart.register(...registerables);

// ----------------- Interfaces -----------------
interface RegionRow {
  region: string;
  total: number;
}

interface BooksStats {
  total: number;
  available: number;
  last_7_days: number;
  last_30_days: number;
  current_month: number;
  previous_month: number;
  by_day_last_30: Array<{ date: string; total: number }>;
  by_month: Array<{ month: string; total: number }>;
}

interface ExchangesStats {
  completed_total: number;
  in_progress_total: number;
  last_7_days: number;
  by_day_last_30: Array<{ date: string; total: number }>;
  by_month: Array<{ month: string; total: number }>;
}

interface AdminSummary {
  total_users: number;
  new_users_last_7_days: number;
  total_books: number;
  available_books: number;
  intercambios_completados: number;
  intercambios_pendientes: number;
  users_by_region: RegionRow[];
  books_stats: BooksStats;
  exchanges_stats: ExchangesStats;
  top_active_users: Array<{
    id_usuario: number;
    nombre_usuario: string;
    email: string;
    total_completed_exchanges: number;
  }>;
  top_publishers: Array<{
    id_usuario__id_usuario: number;
    id_usuario__nombre_usuario: string;
    id_usuario__email: string;
    books_count: number;
  }>;
  top_requesters: Array<{
    id_usuario_solicitante__id_usuario: number;
    id_usuario_solicitante__nombre_usuario: string;
    id_usuario_solicitante__email: string;
    solicitudes_count: number;
  }>;
  top_rated_users: Array<{
    id_usuario_calificado__id_usuario: number;
    id_usuario_calificado__nombre_usuario: string;
    id_usuario_calificado__email: string;
    promedio: number;
    total: number;
  }>;
  genres_books: Array<{ genre: string; total: number }>;
  genres_exchanges: Array<{ genre: string; total: number }>;
}

// Paleta de colores
const PALETTE = [
  '#6366f1',
  '#f97316',
  '#22c55e',
  '#ec4899',
  '#06b6d4',
  '#f59e0b',
  '#a855f7',
  '#14b8a6',
  '#ef4444',
  '#84cc16',
];

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [IonicModule, CommonModule, HttpClientModule, BaseChartDirective],
  templateUrl: './admin-dashboard.page.html',
  styleUrls: ['./admin-dashboard.page.scss'],
})
export class AdminDashboardPage implements OnInit {
  private _loading = signal(true);
  private _data = signal<AdminSummary | null>(null);

  loading = computed(() => this._loading());
  data = computed(() => this._data());

  // ------- Configuración de gráficos -------

  // 1. Libros últimos 30 días (línea)
  public booksLineType: ChartType = 'line';
  public booksLineData: ChartConfiguration<'line'>['data'] = {
    labels: [],
    datasets: [],
  };
  public booksLineOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { mode: 'index', intersect: false },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 8,
        },
      },
      y: {
        beginAtZero: true,
        ticks: { precision: 0 },
      },
    },
  };

  // 2. Intercambios últimos 30 días (línea)
  public exchangesLineData: ChartConfiguration<'line'>['data'] = {
    labels: [],
    datasets: [],
  };
  public exchangesLineOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { mode: 'index', intersect: false },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 8,
        },
      },
      y: {
        beginAtZero: true,
        ticks: { precision: 0 },
      },
    },
  };

  // 3. Usuarios por región (doughnut)
  public usersRegionPieData: ChartConfiguration<'doughnut'>['data'] = {
    labels: [],
    datasets: [],
  };
  public usersRegionPieOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right',
        labels: {
          boxWidth: 12,
          padding: 8,
          font: { size: 11 },
        },
      },
    },
    cutout: '55%',
  };

  // 4. Géneros más publicados (barras horizontales)
  public genresBarData: ChartConfiguration<'bar'>['data'] = {
    labels: [],
    datasets: [],
  };
  public genresBarOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: {
      legend: { display: false },
    },
    scales: {
      x: {
        beginAtZero: true,
        ticks: { precision: 0 },
        grid: { display: true },
      },
      y: {
        grid: { display: false },
      },
    },
  };

  // 5. Distribución de géneros (doughnut) - alternativo
  public genresDoughnutType: ChartType = 'doughnut';
  public genresDoughnutData: ChartConfiguration<'doughnut'>['data'] = {
    labels: [],
    datasets: [],
  };
  public genresDoughnutOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom' },
    },
    cutout: '60%',
  };

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadData();
  }

  loadData(ev?: any) {
    this._loading.set(true);

    const url = `${environment.apiUrl}api/admin/summary/`;

    this.http.get<any>(url).subscribe({
      next: (res) => {
        const mapped: AdminSummary = {
          total_users: res.total_users,
          new_users_last_7_days: res.new_users_last_7_days ?? 0,
          total_books: res.total_books,
          available_books: res.books_stats?.available ?? res.total_books,

          intercambios_completados: res.completed_exchanges,
          intercambios_pendientes: res.in_progress_exchanges,

          users_by_region: (res.users_by_region || []).map((r: any) => ({
            region: r['comuna__id_region__nombre'] || 'Sin región',
            total: r.total,
          })),

          books_stats: res.books_stats || {
            total: res.total_books,
            available: res.total_books,
            last_7_days: 0,
            last_30_days: 0,
            current_month: 0,
            previous_month: 0,
            by_day_last_30: [],
            by_month: [],
          },

          exchanges_stats: res.exchanges_stats || {
            completed_total: res.completed_exchanges,
            in_progress_total: res.in_progress_exchanges,
            last_7_days: 0,
            by_day_last_30: [],
            by_month: [],
          },

          top_active_users: res.top_active_users || [],
          top_publishers: res.top_publishers || [],
          top_requesters: res.top_requesters || [],
          top_rated_users: res.top_rated_users || [],

          genres_books: res.genres_books || [],
          genres_exchanges: res.genres_exchanges || [],
        };

        this._data.set(mapped);
        this.refreshCharts(mapped);

        this._loading.set(false);
        ev?.target?.complete();
      },
      error: (err) => {
        console.error('Error cargando summary admin', err);
        this._loading.set(false);
        ev?.target?.complete();
      },
    });
  }

  // ----------------- Armar datasets de los gráficos -----------------
  private refreshCharts(d: AdminSummary) {
    // 1. Libros por día (últimos 30 días) - Línea
    const booksByDay = d.books_stats?.by_day_last_30 ?? [];
    const bookLabels = booksByDay.map((b) => (b.date ? b.date.slice(5) : ''));
    const bookTotals = booksByDay.map((b) => b.total ?? 0);

    this.booksLineData = {
      labels: bookLabels,
      datasets: [
        {
          data: bookTotals,
          label: 'Libros subidos',
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          backgroundColor: 'rgba(99, 102, 241, 0.15)',
          borderColor: '#6366f1',
        },
      ],
    };

    // 2. Intercambios por día (últimos 30 días) - Línea
    const exchByDay = d.exchanges_stats?.by_day_last_30 ?? [];
    const exchLabels = exchByDay.map((e) => (e.date ? e.date.slice(5) : ''));
    const exchTotals = exchByDay.map((e) => e.total ?? 0);

    this.exchangesLineData = {
      labels: exchLabels,
      datasets: [
        {
          data: exchTotals,
          label: 'Intercambios',
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          backgroundColor: 'rgba(56, 189, 248, 0.15)',
          borderColor: '#0ea5e9',
        },
      ],
    };

    // 3. Usuarios por región - Doughnut
    const regions = d.users_by_region ?? [];
    this.usersRegionPieData = {
      labels: regions.map((r) => r.region),
      datasets: [
        {
          data: regions.map((r) => r.total),
          backgroundColor: regions.map((_, idx) => PALETTE[idx % PALETTE.length]),
          borderWidth: 2,
          borderColor: '#ffffff',
        },
      ],
    };

    // 4. Géneros más publicados - Barras horizontales
    const gb = d.genres_books ?? [];
    this.genresBarData = {
      labels: gb.map((g) => g.genre),
      datasets: [
        {
          data: gb.map((g) => g.total),
          backgroundColor: gb.map((_, idx) => PALETTE[idx % PALETTE.length]),
          borderRadius: 4,
          borderWidth: 0,
        },
      ],
    };

    // 5. Géneros - Doughnut (alternativo)
    this.genresDoughnutData = {
      labels: gb.map((g) => g.genre),
      datasets: [
        {
          data: gb.map((g) => g.total),
          backgroundColor: gb.map((_, idx) => PALETTE[idx % PALETTE.length]),
          borderWidth: 2,
          borderColor: '#ffffff',
        },
      ],
    };
  }
}