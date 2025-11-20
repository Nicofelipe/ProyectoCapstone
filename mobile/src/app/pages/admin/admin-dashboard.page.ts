import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
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

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [IonicModule, CommonModule, BaseChartDirective],
  templateUrl: './admin-dashboard.page.html',
  styleUrls: ['./admin-dashboard.page.scss'],
})
export class AdminDashboardPage implements OnInit {
  private _loading = signal(true);
  private _data = signal<AdminSummary | null>(null);

  loading = computed(() => this._loading());
  data = computed(() => this._data());

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

    // 4. Géneros más publicados - Barras
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

    // 5. Géneros - Doughnut
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
