// src/app/core/interceptors/auth.interceptor.ts
import {
    HttpErrorResponse,
    HttpEvent, HttpHandler, HttpInterceptor, HttpRequest
} from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(private auth: AuthService) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const token = this.auth.accessTokenSync; // 👈 lectura síncrona del cache
    const withAuth = token
      ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : req;

    return next.handle(withAuth).pipe(
      catchError((err: HttpErrorResponse) => {
        if (err.status === 401) {
          // Cualquier 401 ⇒ cerramos sesión local y mandamos al login
          this.auth.forceLogout('Sesión expirada o cerrada en otro dispositivo');
        }
        return throwError(() => err);
      })
    );
  }
}