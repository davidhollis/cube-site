(function ($) {
  var SCRYFALL_DELAY = 50,
    CACHE_TTL = 60 * 60 * 24 * 1000,
    SECTION_HEADER_REGEX = new RegExp("^#\\s+(.*)$"),
    DECKLIST_LINE_REGEX = new RegExp("^(?:(\\d+)x?\\s+)?([^[]+)(?:\\s+\\[([A-Za-z0-9-]+)\\])?$"),
    CARD_BACK_IMAGE = 'http://gatherer.wizards.com/Handlers/Image.ashx?type=card&name=back';
  var scryfallQueue = [],
    queueIsProcessing = false;

  $.fn.mtgCardLink = function () {
    this.each(function () {
      var self = $(this),
        request = elementToScryfallRequest(self);

      request.callback = function (card) {
        var newLink = $('<a>');
        self.replaceWith(function () {
          newLink
            .attr('href', card.scryfallUrl)
            .attr('target', '_blank')
            .addClass('mtg-card-link')
            .data('tooltip-url', card.imageUrl)
            .html(self.html())
          return newLink;
        });
      };
      enqueueScryfallRequest(request);
    });
    $(window.document).tooltip({
      items: 'a.mtg-card-link',
      position: { my: 'left top+15', at: 'left bottom', collision: 'flipfit' },
      content: function () {
        var self = $(this),
          imageUrl = self.data('tooltip-url'),
          tooltipContents = $('<div>');

        tooltipContents.addClass('mtg-card-tooltip');
        if (imageUrl) {
          tooltipContents.append('<img src="' + imageUrl + '">');
        }

        return tooltipContents;
      }
    });
  };

  $.fn.mtgCardDisplay = function () {
    this.each(function () {
      var self = $(this),
        request = elementToScryfallRequest(self);

      request.callback = function (card) {
        self.replaceWith(function () {
          var imageLink = $('<a>'),
            newImage = $('<img>');
          newImage
            .attr('src', card.imageUrl);
          imageLink
            .attr('href', card.scryfallUrl)
            .attr('target', '_blank')
            .addClass('mtg-card-display')
            .append(newImage);
          return imageLink;
        });
      };
      enqueueScryfallRequest(request);
    });
  };

  $.fn.mtgDeck = function () {
    this.replaceWith(function () {
      var self = $(this);

      return parseDecklist(
        self.attr('title'),
        self.text().split("\n")
      );
    });
  };

  function elementToScryfallRequest(element) {
    if (element.data('scryfall-id')) {
      return { scryfallId: element.data('scryfall-id') };
    } else if (element.data('card-name')) {
      return { cardName: element.data('card-name') };
    } else {
      return { cardName: element.html() };
    }
  }

  function parseDecklist(title, lines) {
    var decklist = $('<article>').addClass('mtg-decklist'),
      deckBody = $('<div>').addClass('mtg-decklist-contents'),
      heading = $('<h1>').html(title),
      currentSection = null;

    for (var i = 0, len = lines.length; i < len; ++i) {
      var line = lines[i].trim(),
        match = null;

      if (line == '') {
        // Skip blank lines
      } else if (match = line.match(SECTION_HEADER_REGEX)) {
        currentSection = addDecklistSection(deckBody, match[1]);
      } else if (match = line.match(DECKLIST_LINE_REGEX)) {
        if (currentSection == null) {
          // If we're not in a section, open a blank one
          currentSection = addDecklistSection(deckBody, null);
        }
        addDecklistLine(currentSection, {
          quantity: match[1],
          cardName: match[2],
          scryfallId: match[3]
        });
      } else {
        // No idea what this line is -- skip it
      }
    }

    if (title) {
      decklist.append($('<header>').append(heading));
    }
    decklist.append(
      '<div class="mtg-card-preview">' +
      '<img src="' + CARD_BACK_IMAGE + '">' +
      '</div>'
    );
    decklist.append(deckBody);
    decklist.append('<footer></footer>');

    return decklist;
  }

  function addDecklistSection(deckBody, title) {
    var section = $('<section>'),
      heading = $('<h2>'),
      list = $('<ul>');
    if (title) {
      heading.html(title);
      section.append(heading);
    }
    section.append(list);
    deckBody.append(section);

    return list;
  }

  var handleDecklistHover = function () {
    var self = $(this),
      preview = $('.mtg-card-preview', self.closest('.mtg-decklist')),
      image = $('img', preview),
      cacheKey = self.data('image-url-cache-key'),
      cardDataCache = loadCache(cacheKey);

    if (cardDataCache.isDefined && preview.css('display') != 'none') {
      image.attr('src', cardDataCache.imageUrl);
    } else {
      image.attr('src', CARD_BACK_IMAGE);
    }
  }

  function addDecklistLine(section, card) {
    var line = $('<li>'),
      cardLink = $('<a>');

    if (card.quantity) {
      var quantityLabel = $('<span>');
      quantityLabel.addClass('mtg-card-quantity').html(card.quantity);
      line.append(quantityLabel, '&nbsp;');
    }

    cardLink
      .addClass('mtg-decklist-link')
      .attr('target', '_blank')
      .html(card.cardName)
      .hover(handleDecklistHover);

    var request = {
      callback: function (cardData) {
        cardLink.attr('href', cardData.scryfallUrl);
      }
    };
    if (card.scryfallId) {
      cardLink.data('image-url-cache-key', 'scryfall-id.' + card.scryfallId)
      request.scryfallId = card.scryfallId;
    } else {
      cardLink.data('image-url-cache-key', 'name.' + canonicalizeName(card.cardName))
      request.cardName = card.cardName;
    }
    enqueueScryfallRequest(request);

    line.append(cardLink);
    section.append(line);
  }

  var processQueue = function () {
    if (scryfallQueue.length > 0) {
      queueIsProcessing = true;
      var nextRequest = scryfallQueue.shift();
      makeScryfallRequest(nextRequest, function (wasCached) {
        if (wasCached) {
          setTimeout(processQueue, 0);
        } else {
          setTimeout(processQueue, SCRYFALL_DELAY);
        }
      });
    } else {
      queueIsProcessing = false;
    }
  };

  function enqueueScryfallRequest(request) {
    scryfallQueue.push(request);
    if (!queueIsProcessing) {
      processQueue();
    }
  }

  function makeScryfallRequest(request, nextItem) {
    var storageKey = 'no.such.key',
      requestUrl = '//';
    if ('cardName' in request) {
      storageKey = 'name.' + canonicalizeName(request.cardName);
      requestUrl =
        'https://api.scryfall.com/cards/named?fuzzy=' +
        encodeURIComponent(request.cardName);
    } else {
      storageKey = 'scryfall-id.' + request.scryfallId;
      requestUrl = 'https://api.scryfall.com/cards/' + request.scryfallId;
    }

    var cached = loadCache(storageKey);
    if (cached.isDefined) {
      request.callback(cached);
      nextItem(true);
    } else {
      $.ajax({
        method: 'GET',
        url: requestUrl,
        dataType: 'json',
        success: function (data) {
          var imageUris = data.image_uris;
          if ('card_faces' in data && 'cardName' in request) {
            var canonicalizedName = canonicalizeName(request.cardName);
            for (var i = 0, len = data.card_faces.length; i < len; ++i) {
              if (canonicalizeName(data.card_faces[i].name) == canonicalizedName || !imageUris) {
                imageUris = data.card_faces[i].image_uris;
              }
            }
          }
          var cacheElement = {
            name: (request.cardName || data.name),
            scryfallId: data.id,
            scryfallUrl: data.scryfall_uri,
            imageUrl: imageUris.normal
          };
          storeCache(
            [
              'name.' + canonicalizeName(cacheElement.name),
              'scryfall-id.' + cacheElement.scryfallId
            ],
            cacheElement
          );
          request.callback(cacheElement);
          nextItem(false);
        },
        error: function (xhr, status, message) {
          console.log("Failed to load " + requestUrl + " (" + status + ")")
          nextItem(false);
        }
      });
    }
  }

  function canonicalizeName(cardName) {
    return cardName.toLowerCase().replace(/\W+/g, '-');
  }

  function loadCache(key) {
    var rawStoredValue = window.localStorage.getItem(key);
    if (rawStoredValue === null) {
      return { 'isDefined': false };
    } else {
      var value = JSON.parse(rawStoredValue);
      if (value.expiration < Date.now().valueOf()) {
        window.localStorage.removeItem(key);
        return { 'isDefined': false };
      } else {
        value.isDefined = true;
        return value;
      }
    }
  }

  function storeCache(keys, value) {
    value.expiration = Date.now().valueOf() + CACHE_TTL;
    var valStr = JSON.stringify(value);
    keys.forEach(function (key) {
      window.localStorage.setItem(key, valStr);
    });
  }
})(jQuery);