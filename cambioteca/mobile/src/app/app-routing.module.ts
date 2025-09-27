import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },

  { path: 'home', loadComponent: () => import('./pages/home/home.page').then(m => m.HomePage) },
  { path: 'books', loadComponent: () => import('./pages/books/list/list.page').then(m => m.ListPage) },

  // Resultados por título (dos alias, si quieres conservar ambos)
  { path: 'books/by-title/:title', loadComponent: () => import('./pages/books/title-results/title-results.page').then(m => m.TitleResultsPage) },
  { path: 'books/title/:title',    loadComponent: () => import('./pages/books/title-results/title-results.page').then(m => m.TitleResultsPage) },

  // Vista de publicación (dos alias, si quieres conservar ambos)
  { path: 'books/view/:id', loadComponent: () => import('./pages/books/view/view.page').then(m => m.ViewPage) },
  { path: 'books/:id',      loadComponent: () => import('./pages/books/view/view.page').then(m => m.ViewPage) },

  { path: 'auth/register', loadComponent: () => import('./pages/auth/register/register.page').then(m => m.RegisterPage) },
  { path: 'auth/login',    loadComponent: () => import('./pages/auth/login/login.page').then(m => m.LoginPage) },
  { path: 'auth/forgot',   loadComponent: () => import('./pages/auth/forgot/forgot.page').then(m => m.ForgotPage) },
  { path: 'auth/reset/:token', loadComponent: () => import('./pages/auth/reset/reset.page').then(m => m.ResetPage) },

  { path: 'profile', loadComponent: () => import('./pages/profile/profile.page').then(m => m.ProfilePage) },
  { path: 'my-books', loadComponent: () => import('./pages/my-books/my-books.page').then(m => m.MyBooksPage) },
  { path: 'my-books/:id', loadComponent: () => import('./pages/book-detail/book-detail.page').then(m => m.MyBookDetailPage) },
  { path: 'add-book', loadComponent: () => import('./pages/add-book/add-book.page').then(m => m.AddBookPage) },

  { path: '**', redirectTo: 'home' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules, initialNavigation: 'enabledBlocking' })],
  exports: [RouterModule],
})
export class AppRoutingModule { }
