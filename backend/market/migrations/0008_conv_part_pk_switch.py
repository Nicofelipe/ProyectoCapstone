# market/migrations/0008_conv_part_pk_switch.py
from django.db import migrations, models

class Migration(migrations.Migration):

    dependencies = [
        ('market', '0007_fix_participantes_pk'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],  # <-- NO cambia la BD
            state_operations=[
                # Asegura que el modelo apunta a la tabla real y es managed
                migrations.AlterModelOptions(
                    name='conversacionparticipante',
                    options={'managed': True, 'db_table': 'conversacion_participante'},
                ),
                # Alinea el tipo de PK al INT autoincrement que ya tienes (no BIGINT)
                migrations.AlterField(
                    model_name='conversacionparticipante',
                    name='id',
                    field=models.AutoField(primary_key=True, serialize=False),
                ),
                # Declara en el "state" la misma UNIQUE ya existente en MySQL
                migrations.AddConstraint(
                    model_name='conversacionparticipante',
                    constraint=models.UniqueConstraint(
                        fields=['id_conversacion', 'id_usuario'],
                        name='uq_conv_user',
                    ),
                ),
            ],
        ),
    ]
