// src/app/pages/admin/admin-dashboard.page.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import {
  Chart,
  ChartConfiguration,
  ChartOptions,
  ChartType,
  registerables,
} from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { AdminService, AdminSummary } from 'src/app/core/services/admin.service';

Chart.register(...registerables);

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

type DashboardPeriod = '30d' | '12m';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, BaseChartDirective],
  templateUrl: './admin-dashboard.page.html',
  styleUrls: ['./admin-dashboard.page.scss'],
})
export class AdminDashboardPage implements OnInit {
  private _loading = signal(true);
  private _data = signal<AdminSummary | null>(null);

  loading = computed(() => this._loading());
  data = computed(() => this._data());

  // ----- Filtros de donaciones (año/mes) -----
  selectedYear = signal<'all' | number>('all');
  selectedMonth = signal<'all' | number>('all');

  get selectedYearModel(): 'all' | number {
    return this.selectedYear();
  }
  set selectedYearModel(value: 'all' | number) {
    this.selectedYear.set(value);
  }

  get selectedMonthModel(): 'all' | number {
    return this.selectedMonth();
  }
  set selectedMonthModel(value: 'all' | number) {
    this.selectedMonth.set(value);
  }

  // Años disponibles según las donaciones
  years = computed(() => {
    const d = this._data();
    const stats = d?.donations_stats;
    if (!stats) return [];

    const set = new Set<number>();
    stats.by_month.forEach((row) => {
      const date = new Date(row.month);
      if (!isNaN(date.getTime())) {
        set.add(date.getFullYear());
      }
    });
    return Array.from(set).sort();
  });

  // Lista de donaciones por mes filtrada por año/mes
  donationsByMonthFiltered = computed(() => {
    const d = this._data();
    const stats = d?.donations_stats;
    if (!stats) return [];

    const yearFilter = this.selectedYear();
    const monthFilter = this.selectedMonth();

    return stats.by_month.filter((row) => {
      const date = new Date(row.month);
      if (isNaN(date.getTime())) return false;

      const year = date.getFullYear();
      const month = date.getMonth() + 1; // 1–12

      const yearOk = yearFilter === 'all' || year === yearFilter;
      const monthOk = monthFilter === 'all' || month === monthFilter;

      return yearOk && monthOk;
    });
  });

  // ----- Filtro de período global (30 días / 12 meses) -----
  private _period = signal<DashboardPeriod>('30d');

  get periodModel(): DashboardPeriod {
    return this._period();
  }
  set periodModel(value: DashboardPeriod) {
    this._period.set(value);
    const current = this._data();
    if (current) {
      this.refreshCharts(current); // recomputa gráficos cuando cambia el filtro
    }
  }

  // ----- Métricas derivadas por período para las cards -----
  booksInPeriod = computed(() => {
    const d = this._data();
    if (!d || !d.books_stats) return 0;
    const period = this._period();

    if (period === '30d') {
      return d.books_stats.last_30_days ?? 0;
    }

    const byMonth = d.books_stats.by_month ?? [];
    if (!byMonth.length) return 0;

    const last12 = byMonth.slice(-12);
    return last12.reduce((acc: number, row: any) => acc + (row.total ?? 0), 0);
  });

  exchangesInPeriod = computed(() => {
    const d = this._data();
    if (!d || !d.exchanges_stats) return 0;
    const period = this._period();

    if (period === '30d') {
      const byDay = d.exchanges_stats.by_day_last_30 ?? [];
      return byDay.reduce((acc: number, row: any) => acc + (row.total ?? 0), 0);
    }

    const byMonth = d.exchanges_stats.by_month ?? [];
    if (!byMonth.length) return 0;

    const last12 = byMonth.slice(-12);
    return last12.reduce((acc: number, row: any) => acc + (row.total ?? 0), 0);
  });

  donationsAmountInPeriod = computed(() => {
    const d = this._data();
    const stats = d?.donations_stats;
    if (!stats) return 0;
    const period = this._period();

    if (period === '30d') {
      return stats.last_30_days?.amount ?? 0;
    }

    const byMonth = stats.by_month ?? [];
    if (!byMonth.length) return 0;

    const last12 = byMonth.slice(-12);
    return last12.reduce(
      (acc: number, row: any) => acc + (row.amount ?? 0),
      0
    );
  });

  donationsCountInPeriod = computed(() => {
    const d = this._data();
    const stats = d?.donations_stats;
    if (!stats) return 0;
    const period = this._period();

    if (period === '30d') {
      return stats.last_30_days?.count ?? 0;
    }

    const byMonth = stats.by_month ?? [];
    if (!byMonth.length) return 0;

    const last12 = byMonth.slice(-12);
    return last12.reduce(
      (acc: number, row: any) => acc + (row.count ?? 0),
      0
    );
  });

  // Color del badge de variación de donaciones
  donationVariationColor(): 'success' | 'danger' | 'medium' {
    const d = this._data();
    const pct = d?.donations_stats?.variation?.amount_percent;

    if (pct == null) return 'medium';
    if (pct >= 0) return 'success';
    return 'danger';
  }

  // ------- Configuración de gráficos -------

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

  constructor(private adminService: AdminService) {}

  ngOnInit() {
    this.loadData();
  }

  loadData(ev?: any) {
    this._loading.set(true);

    this.adminService.getSummary().subscribe({
      next: (summary) => {
        this._data.set(summary);
        this.refreshCharts(summary);
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

  private refreshCharts(d: AdminSummary) {
    const period = this._period();

    // 1. Libros - según período
    if (period === '30d') {
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
    } else {
      // últimos 12 meses agregados por mes
      let booksByMonth = d.books_stats?.by_month ?? [];
      if (booksByMonth.length > 12) {
        booksByMonth = booksByMonth.slice(-12);
      }

      const bookLabels = booksByMonth.map((b) =>
        b.month ? b.month.slice(0, 7) : ''
      );
      const bookTotals = booksByMonth.map((b) => b.total ?? 0);

      this.booksLineData = {
        labels: bookLabels,
        datasets: [
          {
            data: bookTotals,
            label: 'Libros subidos (por mes)',
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
    }

    // 2. Intercambios - según período
    if (period === '30d') {
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
    } else {
      let exchByMonth = d.exchanges_stats?.by_month ?? [];
      if (exchByMonth.length > 12) {
        exchByMonth = exchByMonth.slice(-12);
      }

      const exchLabels = exchByMonth.map((e) =>
        e.month ? e.month.slice(0, 7) : ''
      );
      const exchTotals = exchByMonth.map((e) => e.total ?? 0);

      this.exchangesLineData = {
        labels: exchLabels,
        datasets: [
          {
            data: exchTotals,
            label: 'Intercambios (por mes)',
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
    }

    // 3. Usuarios por región - Doughnut
    const regions = d.users_by_region ?? [];
    this.usersRegionPieData = {
      labels: regions.map((r: any) => r.region ?? 'Sin región'),
      datasets: [
        {
          data: regions.map((r: any) => r.total ?? 0),
          backgroundColor: regions.map(
            (_: unknown, idx: number) => PALETTE[idx % PALETTE.length]
          ),
          borderWidth: 2,
          borderColor: '#ffffff',
        },
      ],
    };

    // 4. Géneros más publicados - Barras
    const gb = d.genres_books ?? [];
    this.genresBarData = {
      labels: gb.map((g) => g.genre),
      datasets: [
        {
          data: gb.map((g) => g.total),
          backgroundColor: gb.map(
            (_: unknown, idx: number) => PALETTE[idx % PALETTE.length]
          ),
          borderRadius: 4,
          borderWidth: 0,
        },
      ],
    };

    // 5. Géneros - Doughnut
    this.genresDoughnutData = {
      labels: gb.map((g) => g.genre),
      datasets: [
        {
          data: gb.map((g) => g.total),
          backgroundColor: gb.map(
            (_: unknown, idx: number) => PALETTE[idx % PALETTE.length]
          ),
          borderWidth: 2,
          borderColor: '#ffffff',
        },
      ],
    };
  }
}
