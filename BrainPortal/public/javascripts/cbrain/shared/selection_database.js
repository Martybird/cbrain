
/*
#
# CBRAIN Project
#
# Copyright (C) 2008-2012
# The Royal Institution for the Advancement of Learning
# McGill University
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.
#
*/

/*
 * Client-side selection database
 * This JS partial implements almost all of the persistent selection behavior
 * specified in the _persistent_selection.html.erb partial (as the HTML partial
 * is the public interface to the persistent selection mechanism).
 * Event namespace: .psel
 */

(function () {
  "use strict";

  if (!window.indexedDB)
    window.indexedDB =
      window.mozIndexedDB ||
      window.webkitIndexedDB ||
      window.msIndexedDB;

  if (!window.IDBTransaction)
    window.IDBTransaction =
      window.webkitIDBTransaction ||
      window.msIDBTransaction;

  if (!window.IDBKeyRange)
    window.IDBKeyRange =
      window.webkitIDBKeyRange ||
      window.msIDBKeyRange;

  if (typeof window.console === 'undefined')
    window.console = { log: function () { } };

  if (!window.indexedDB || !window.Worker) {
    $('.persistent-selection').remove();
    return;
  }

  /* stub to open an IndexedDB store (see the open-database section) */
  var open_store = function () { return null; };

  /*
   * +refresh+ event
   * Present on .persistent-selection nodes, refreshes the current persistent
   * selection's item count. Trigger this event if the persistent selection
   * has changed and the displayed count has to be updated accordingly.
   */
  $(document).delegate('.persistent-selection', 'refresh.psel', function psel_refresh() {
    var psel   = $(this),
        count  = psel.find('.psel-count');

    var store = open_store(psel.data('store-name'), (function (that) {
      return function () { psel_refresh.call(that) };
    })(this));

    if (!store) return;

    var request = store.count();
    count.addClass('psel-refresh');

    request.onerror = function (event) {
      console.log('[psel] count(): ' + request.error);

      count
        .removeClass('psel-refresh')
        .addClass('psel-zero')
        .text('0');

      psel.trigger('ready.psel');
      event.preventDefault();
    };

    request.onsuccess = function () {
      count
        .removeClass('psel-refresh')
        .toggleClass('psel-zero', request.result === 0)
        .text(request.result);

      psel.trigger('ready.psel');
    };
  });

  /*
   * +ready+ event
   * Present on .persistent-selection nodes, invoked when the persistent
   * selection component has finished loading/updating/refreshing and the
   * component's .psel-count node can be expected to contain the current
   * persistent selection count. Triggered when the +refresh+ event completes.
   */
  /* No default handler; this event is intended for other modules to use. */

  /*
   * +reload+ event
   * Present on .persistent-selection nodes, reload the persistent selection
   * UI, event bindings and current persistent selection set (see the
   * +generate+ event).
   */
  $(document).delegate('.persistent-selection', 'reload.psel', function psel_reload() {
    var psel = $(this),
        bind_selector  = psel.data('bind-selector'),
        watch_selector = psel.data('watch-selector'),
        store_name     = psel.data('store-name'),
        all_url        = psel.data('all-url'),
        selected_url   = psel.data('selected-url');

    /* make sure the up-to-date selection state is shown */
    psel.trigger('refresh.psel');

    /* Bound/watched elements */

    /* initialize bound elements according to their selection status */
    if (bind_selector) {
      (function initialize() {
        var store = open_store(store_name, initialize);
        if (!store) return;

        psel.trigger('status.psel', ['bound']);

        /* once all bound elements are initialized... */
        store.transaction.oncomplete = function () {
          psel.trigger('status.psel', [null]);
          psel.trigger('generate.psel');
        };

        /* check each bound element's value against the DB */
        $(bind_selector).each(function () {
          var element = $(this),
              request = store.get(element.val());

          request.onerror = function (event) {
            element.prop('checked', false);
          };

          request.onsuccess = function () {
            element.prop('checked', !!request.result);
          };
        });
      })();

    } else {
      setTimeout(function () {
        psel.trigger('generate.psel');
      }, 0);
    }

    /* add/remove sets of values from the selection set */
    function update(add, remove, done) {
      var store = open_store(store_name, function () { update(add, remove, done); });
      if (!store) return;

      var transaction = store.transaction;
      var components = $('.persistent-selection').filter(function () {
        return $(this).data('bind-selector') === bind_selector;
      });

      transaction.onerror = function (event) {
        if (transaction.error)
          console.log('[psel] add()/delete(): ' + transaction.error);

        event.preventDefault();
      };

      transaction.oncomplete = function () {
        components.trigger('refresh.psel');

        if (done) done();
      };

      (add || []).forEach(function (value) {
        store.add({ id: value.toString() })
      });

      (remove || []).forEach(function (value) {
        store.delete(value.toString())
      });
    };

    /* add/remove from the selection set when bound elements change */
    if (bind_selector)
      $(document)
        .undelegate(bind_selector, 'change.psel')
        .delegate(  bind_selector, 'change.psel', function psel_bchange() {
          var value   = $(this).val(),
              checked = this.checked;

          /*
           * keep track of deselected elements (exceptions from the generated
           * selection array in psel-val) explicitly in psel-ex.
           */
          function update_exceptions() {
            var except = (psel.data('except') || []),
                index  = except.indexOf(value);

            if (checked && index > -1)
              except.splice(index, 1);

            else if (!checked && index == -1)
              except.push(value);

            else
              return;

            psel
              .data('except', except)
              .find('.psel-ex')
              .val(JSON.stringify(except));
          };

          if (this.checked)
            update([value], [], update_exceptions);
          else
            update([], [value], update_exceptions);
        });

    /* check the entire bound element set when watched elements are triggered */
    if (watch_selector)
      $(document)
        .undelegate(watch_selector, 'change.psel')
        .delegate(  watch_selector, 'change.psel', function psel_wchange() {
          var add    = [],
              remove = [];

          $(bind_selector).each(function () {
            (this.checked ? add : remove).push($(this).val());
          });

          psel
            .data('except', remove)
            .find('.psel-ex')
            .val(JSON.stringify(remove));

          update(add, remove);
        });

    /* Action links/buttons */

    /* select all items on all pages */
    if (all_url)
      psel
        .undelegate('.psel-all', 'click.psel')
        .delegate(  '.psel-all', 'click.psel', function () {
          $(bind_selector).prop('checked', true);
          psel.trigger('status.psel', ['fetch']);

          $.get(all_url, function (data) {
            update(data, [], function () {
              psel.trigger('status.psel', [null]);
              psel.trigger('generate.psel');
            });
          }, 'json');
        });

    /* clear selection */
    psel
      .undelegate('.psel-clear', 'click.psel')
      .delegate(  '.psel-clear', 'click.psel', function () {
        psel.trigger('clear.psel');
      });
  });

  /*
   * +clear+ event
   * Present on .persistent-selection nodes, clear the current persistent
   * selection set. This event takes one optional argument; whether or not
   * to do a +bare+ reload which only clears the selection set without updating
   * the UI or the bound elements.
   */
  $(document).delegate('.persistent-selection', 'clear.psel', function psel_clear(event, bare) {
    var store_name = $(this).data('store-name');

    var store = open_store(store_name, (function (that) {
      return function () { psel_clear.call(that, bare); };
    })(this));

    if (!store) return;

    var components = $('.persistent-selection').filter(function () {
      return $(this).data('store-name') === store_name;
    });

    components.trigger('status.psel', ['clear']);

    var request = store.clear();
    request.onsuccess = function () {
      components.trigger('status.psel', [null]);
      if (bare) return;

      components.trigger('refresh.psel');

      components.find('.psel-val')
        .val('[]');

      components
        .data('except', [])
        .find('.psel-ex')
        .val('[]');

      components.each(function () {
        $($(this).data('bind-selector'))
          .prop('checked', false);
      });
    };
  });

  /*
   * +generate+ event
   * Present on .persistent-selection nodes, generate a JSON list of the current
   * persistent selection set in the psel-val hidden field. Note that this event
   * requires the database store to already exist and is quite expensive as it
   * requires dumping the entire database store. Trigger this event to update
   * the selection set to send to the server.
   */
  $(document).delegate('.persistent-selection', 'generate.psel', function psel_generate() {
    var store_name = $(this).data('store-name');

    var store = open_store(store_name, (function (that) {
      return function () { psel_generate.call(that); };
    })(this));

    if (!store) return;

    var selected = [];
    var components = $('.persistent-selection').filter(function () {
      return $(this).data('store-name') === store_name;
    });

    components.trigger('status.psel', ['generate']);

    store.openCursor().onsuccess = function (event) {
      var cursor = event.target.result;

      if (cursor) {
        selected.push(cursor.key);
        cursor.continue();

      } else {
        components.find('.psel-val')
          .val(JSON.stringify(selected));

        components
          .data('except', [])
          .find('.psel-ex')
          .val('[]');

        components.trigger('status.psel', [null]);
      }
    };
  });

  /*
   * +status+ event
   * Present on .persistent-selection nodes, changes the selection component's
   * status icon. This event takes one optional argument; the icon name to set
   * the status to, one of 'generate', 'fetch' or 'bound' corresponding to,
   * respectively; generating the selection set (+generate+ event), fetching
   * all possible selectable values from the server (select-all action) and
   * initialization of bound elements.
   */
  $(document).delegate('.persistent-selection', 'status.psel', (function () {
    /* available jQuery UI status icons for the status indicator (psel-icon) */
    var icons = {
      generate: 'ui-icon-refresh',
      fetch:    'ui-icon-arrowstop-1-s',
      bound:    'ui-icon-arrowstop-1-e',
      clear:    'ui-icon-trash'
    };

    icons.all = Object.keys(icons)
      .map(function (key) { return icons[key]; })
      .join(' ');

    return function (event, state) {
      var icon = $(this).find('.psel-icon');

      icon
        .removeClass(icons.all)
        .css({ visibility: !!state ? 'visible' : 'hidden' });

      if (state && icons[state]) icon.addClass(icons[state]);
    };
  })());

  /* quick database-less refresh to display something while the DB opens */
  $('.persistent-selection').trigger('refresh.psel');

  /* open up the persistent selection IndexedDB database */
  (function () {
    var request = window.indexedDB.open('persistent-selection');

    request.onerror = function (event) {
      console.log('[psel] open(): ' + request.error);
      $('.persistent-selection').remove();

      event.preventDefault();
    };

    /* the DB is available! set up open_store and refresh */
    request.onsuccess = function (event) {
      var database = request.result;

      /*
       * Open an IndexedDB object store named +store+. If it does not exist
       * yet, create it and invoke the +again+ callback once it has been
       * created (usually to retry the operation).
       */
      open_store = function (store, again) {
        if (database.objectStoreNames.contains(store))
          return database.transaction(store, "readwrite").objectStore(store);

        var version = parseInt(database.version) + 1;
        database.close();

        var request = window.indexedDB.open('persistent-selection', version);

        request.onerror = function (event) {
          console.log('[psel] open(): ' + request.error);
          $('.persistent-selection').remove();

          event.preventDefault();
        };

        request.onsuccess = function () {
          database = request.result;
          if (again) again();
        };

        request.onupgradeneeded = function () {
          request.result.createObjectStore(store, { keyPath: 'id' });
        };

        return null;
      };

      /* the DB is now available, load the UI */
      $('.persistent-selection').trigger('reload.psel');
    };
  })();

  /* force a full reload when new content is loaded */
  $(document).bind('new_content', function () {
    $('.persistent-selection').trigger('reload.psel');
  });
})();
