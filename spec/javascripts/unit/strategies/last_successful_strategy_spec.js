describe("LastSuccessfulStrategy", function() {
  var substrategy;
  var strategy;
  var callback;

  beforeEach(function() {
    substrategy = Pusher.Mocks.getStrategy(true);
    strategy = new Pusher.LastSuccessfulStrategy(substrategy, {});
    callback = jasmine.createSpy("callback");

    jasmine.Clock.useMock();
  });

  it("should expose its name", function() {
    expect(strategy.name).toEqual("last_successful");
  });

  describe("after calling isSupported", function() {
    it("should return true when the substrategy is supported", function() {
      substrategy = Pusher.Mocks.getStrategy(true);
      strategy = new Pusher.LastSuccessfulStrategy(substrategy, {});
      expect(strategy.isSupported()).toBe(true);
    });

    it("should return false when the substrategy is not supported", function() {
      substrategy = Pusher.Mocks.getStrategy(false);
      strategy = new Pusher.LastSuccessfulStrategy(substrategy, {});
      expect(strategy.isSupported()).toBe(false);
    });
  });

  describe("on browsers supporting localStorage", function() {
    var localStorage;

    beforeEach(function() {
      localStorage = {};
      spyOn(Pusher.Util, "getLocalStorage").andReturn(localStorage);
    });

    describe("without cached transport", function() {
      it("should try the substrategy immediately when cache is empty", function() {
        strategy.connect(callback);
        expect(substrategy.connect).toHaveBeenCalled();
      });

      it("should try the substrategy immediately when cache is stale", function() {
        localStorage.pusherTransport = JSON.stringify({
          timestamp: Pusher.Util.now() - 1801*1000 // default ttl is 1800s
        });

        strategy.connect(callback);
        expect(substrategy.connect).toHaveBeenCalled();
      });

      it("should abort the substrategy when requested", function() {
        var runner = strategy.connect(callback);
        runner.abort();
        expect(substrategy._abort).toHaveBeenCalled();
      });

      describe("after connecting successfully", function() {
        var connection;
        var startTimestamp;

        beforeEach(function() {
          startTimestamp = Pusher.Util.now();
          spyOn(Pusher.Util, "now").andReturn(startTimestamp);

          strategy.connect(callback);
          Pusher.Util.now.andReturn(startTimestamp + 1000);

          connection = {
            name: "test",
            options: { encrypted: false, "hostUnencrypted": "example.com" }
          };
          substrategy._callback(null, connection);
        });

        it("should call back after connecting successfully", function() {
          expect(callback).toHaveBeenCalledWith(null, connection);
        });

        it("should cache the connected transport", function() {
          expect(JSON.parse(localStorage.pusherTransport)).toEqual({
            timestamp: Pusher.Util.now(),
            latency: 1000,
            scheme: {
              type: "transport",
              transport: "test",
              encrypted: false,
              hostUnencrypted: "example.com"
            }
          });
        });
      });

      describe("after receiving an error", function() {
        beforeEach(function() {
          // set a very low timestamp to have something unused in the cache
          localStorage.pusherTransport = JSON.stringify({
            timestamp: 0
          });
          strategy.connect(callback);
          substrategy._callback(1);
        });

        it("should call back after receiving an error from the substrategy", function() {
          expect(callback).toHaveBeenCalledWith(1);
        });

        it("should flush the transport cache", function() {
          expect(localStorage.pusherTransport).toBe(undefined);
        });
      });
    });

    describe("with cached transport", function() {
      var cachedStrategy;

      beforeEach(function() {
        cachedStrategy = Pusher.Mocks.getStrategy(true);
        localStorage.pusherTransport = JSON.stringify({
          timestamp: Pusher.Util.now(),
          latency: 1000,
          scheme: {
            type: "transport",
            transport: "test",
            encrypted: false,
            hostUnencrypted: "example.com"
          }
        });
        spyOn(Pusher.StrategyBuilder, "build").andReturn(cachedStrategy);
      });

      it("should reconstruct the transport with correct options", function() {
        strategy = new Pusher.LastSuccessfulStrategy(substrategy, {
          key: "itsakey"
        });
        strategy.connect(callback);

        expect(Pusher.StrategyBuilder.build.calls.length).toEqual(1);
        expect(Pusher.StrategyBuilder.build).toHaveBeenCalledWith({
          type: "transport",
          transport: "test",
          encrypted: false,
          hostUnencrypted: "example.com",
          key: "itsakey"
        });
      });

      it("should try the cached strategy first", function() {
        strategy.connect(callback);
        expect(cachedStrategy.connect).toHaveBeenCalled();
      });

      it("should abort the cached transport and not call the substrategy", function() {
        var runner = strategy.connect(callback);
        runner.abort();
        expect(cachedStrategy._abort).toHaveBeenCalled();
        expect(substrategy.connect).not.toHaveBeenCalled();
      });

      describe("after connecting successfully with cached transport", function() {
        beforeEach(function() {
          startTimestamp = Pusher.Util.now();
          spyOn(Pusher.Util, "now").andReturn(startTimestamp);

          strategy.connect(callback);
          Pusher.Util.now.andReturn(startTimestamp + 2000);

          connection = {
            name: "cached",
            options: { encrypted: false, "hostUnencrypted": "example.org" }
          };
          cachedStrategy._callback(null, connection);
        });

        it("should call back with the connection", function() {
          expect(callback).toHaveBeenCalledWith(null, connection);
        });

        it("should not try the substrategy", function() {
          expect(substrategy.connect).not.toHaveBeenCalled();
        });

        it("should cache the connected transport", function() {
          expect(JSON.parse(localStorage.pusherTransport)).toEqual({
            timestamp: Pusher.Util.now(),
            latency: 2000,
            scheme: {
              type: "transport",
              transport: "cached",
              encrypted: false,
              hostUnencrypted: "example.org"
            }
          });
        });
      });

      describe("after double the cached latency", function() {
        beforeEach(function() {
          startTimestamp = Pusher.Util.now();
          spyOn(Pusher.Util, "now").andReturn(startTimestamp);

          strategy.connect(callback);

          Pusher.Util.now.andReturn(startTimestamp + 4001);
          jasmine.Clock.tick(4001);
        });

        it("should abort the cached strategy", function() {
          expect(cachedStrategy._abort).toHaveBeenCalled();
        });

        it("should fall back to the substrategy", function() {
          expect(substrategy.connect).toHaveBeenCalled();
        });

        it("should flush the transport cache", function() {
          expect(localStorage.pusherTransport).toBe(undefined);
        });
      });

      describe("after failing to connect with the cached transport", function() {
        var runner;

        beforeEach(function() {
          startTimestamp = Pusher.Util.now();
          spyOn(Pusher.Util, "now").andReturn(startTimestamp);

          runner = strategy.connect(callback);
          Pusher.Util.now.andReturn(startTimestamp + 2000);
          cachedStrategy._callback("error");
          Pusher.Util.now.andReturn(startTimestamp + 2500);
        });

        it("should fall back to the substrategy", function() {
          expect(substrategy.connect).toHaveBeenCalled();
        });

        it("should flush the transport cache", function() {
          expect(localStorage.pusherTransport).toBe(undefined);
        });

        it("should abort the substrategy when requested", function() {
          runner.abort();
          expect(cachedStrategy._abort).not.toHaveBeenCalled();
          expect(substrategy._abort).toHaveBeenCalled();
        });

        describe("and connecting successfully using the substrategy", function() {
          beforeEach(function() {
            connection = {
              name: "new",
              options: { encrypted: true, "hostEncrypted": "example.net" }
            };
            substrategy._callback(null, connection);
          });

          it("should call back with the connection", function() {
            expect(callback).toHaveBeenCalledWith(null, connection);
          });

          it("should cache the connected transport", function() {
            expect(JSON.parse(localStorage.pusherTransport)).toEqual({
              timestamp: Pusher.Util.now(),
              latency: 500,
              scheme: {
                type: "transport",
                transport: "new",
                encrypted: true,
                hostEncrypted: "example.net"
              }
            });
          });
        });

        describe("and failing to connect using the substrategy", function() {
          beforeEach(function() {
            substrategy._callback("error again");
          });

          it("should call back with the error", function() {
            expect(callback).toHaveBeenCalledWith("error again");
          });

          it("should flush the transport cache", function() {
            expect(localStorage.pusherTransport).toBe(undefined);
          });
        });
      });
    });
  });

  describe("on browsers not supporting localStorage", function() {
    beforeEach(function() {
      spyOn(Pusher.Util, "getLocalStorage").andReturn(undefined);
    });

    it("should try the substrategy immediately", function() {
      strategy.connect(callback);
      expect(substrategy.connect).toHaveBeenCalled();
    });
  });
});
