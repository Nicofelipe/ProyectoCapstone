import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Injectable({ providedIn: 'root' })
export class AdminGuard implements CanActivate {
  constructor(private auth: AuthService, private router: Router) {}
  async canActivate(): Promise<boolean> {
    await this.auth.restoreSession();
    const me = this.auth.user;
    if (me?.es_admin) return true;
    this.router.navigateByUrl('/not-authorized');
    return false;
  }
}