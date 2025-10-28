import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Preferences } from '@capacitor/preferences';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(private router: Router) {}
  async canActivate(): Promise<boolean> {
    const { value } = await Preferences.get({ key: 'token' });
    if (!value) {
      this.router.navigateByUrl('/login');
      return false;
    }
    return true;
  }
}
