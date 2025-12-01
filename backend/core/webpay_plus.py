# core/webpay_plus.py
from django.conf import settings
from transbank.webpay.webpay_plus.transaction import Transaction
from transbank.common.integration_type import IntegrationType
from transbank.common.options import WebpayOptions


def get_transaction():
    """
    Devuelve un objeto Transaction configurado según tu entorno.
    """
    if settings.WEBPAY_ENV.upper() == "PRODUCCION":
        integration_type = IntegrationType.PRODUCTION
    else:
        integration_type = IntegrationType.TEST  # INTEGRACION

    options = WebpayOptions(
        commerce_code=settings.WEBPAY_COMMERCE_CODE,
        api_key=settings.WEBPAY_API_KEY,
        integration_type=integration_type,
    )
    return Transaction(options)
