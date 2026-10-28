  <script>
    const db = new Dexie('arbeitszeit');
    db.version(1).stores({ entries: 'date' });
    // v2: Urlaubstage (bezahlt / unbezahlt)
    db.version(2).stores({ entries: 'date', leave: 'date' });
  </script>
