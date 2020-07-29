
// we keep up to N unjoined decisions before dropping them
const max_unjoined = 10
let unjoined_decisions = []

function record_decison(event_id, chosen_action, context)
{
    unjoined_decisions.push( {
        event_id,
        chosen_action,
        context
    });
}
function add_feature(ex_builder, name, value) {
    // console.log(`${name}::${value}`)
    if(typeof value === "string" || value == null) {
        if(value)
            value = value.replace(new RegExp('[^a-zA-Z0-9]', "gm"), '_');
        Module.vw_push_feature_string(ex_builder, name + "=" + value, 1.0);
    }
    else {
        Module.vw_push_feature_string(ex_builder, name, value);
    }
}

function add_namespace(example, ns_name, ns_data)
{
    const builder = Module.vw_alloc_example_builder(example, ns_name);

    for(var feature in ns_data) {
        add_feature(builder, feature, ns_data[feature]);
    }

    Module.vw_free_example_builder(builder);
}

async function make_rl_decision(request) {
    console.log('make_rl_decision');
    if (!request || !(request.actions.length > 0)) {
        console.log("bad request data: " +JSON.stringify(request));
        throw new "bad request data";
    }
    try {
        const vw_obj = await loadVwPredict();
        console.log('vw_obj up and running')

        let shared = Module.vw_alloc_example();
        console.log('shared action 0x' + shared.toString(16))

        for(var ns in request.context) {
            // console.log('new shared ns: ' + ns)
            add_namespace(shared, ns, request.context[ns])
        }

        let actions = []

        for(var i = 0; i < request.actions.length; ++i) {
            let action = Module.vw_alloc_example();
            console.log("action " + i + ' 0x' + action.toString(16));
            var action_data = request.actions[i];

            for(var ns in action_data) {
                if(ns.startsWith("__")) //ignore metadata __idx and __id
                    continue;
                // console.log(`action [${i}] ns ${ns}`);
                add_namespace(action, ns, action_data[ns])
            }
            actions.push(action);
        }

        var ptr = Module._malloc(actions.length * 4);
        var arrayView = new Int32Array(Module.HEAPU8.buffer, ptr);
        for (var i = 0; i < actions.length; ++i) {
            arrayView[i] = actions[i];
        }

        let event_id = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        let prediction = Module.vw_predict(vw_obj, event_id, shared, ptr, actions.length);
        Module._free(ptr);

        r = "ranking: ";
        p = "pdf: ";
        for(var i = 0; i < Module.vw_prediction_size(prediction); ++i) {
            r += Module.vw_prediction_get_ranking(prediction, i) + " ";
            p += Module.vw_prediction_get_pdf(prediction, i) + " ";
        }
        console.log(r);
        console.log(p);

        const res = {
            action: Module.vw_prediction_get_ranking(prediction, 0),
            event_id: event_id
        };

        record_decison(event_id, res.action, request);

        Module.vw_free_prediction(prediction)
        actions.forEach(a => Module.vw_free_example(a));
        Module.vw_free_example(shared)

        console.log('decision result ' + JSON.stringify(res))
        return res;
    }catch(e) {
        console.log('decision failed with ' + e);
        throw e;
    }
};

async function record_click(click)
{
    
}

function notify(request, sender, sendResponse) {
    console.log('got msg ' + request.kind);
    if(request.kind == 'decision') {
        return make_rl_decision(request.context);
    } else if(request.kind == 'click') {
        return Promise.resolve({logged: true});
    } else {
        return Promise.reject('invalid message kind: ' + request.kind);
    }
}

browser.runtime.onMessage.addListener(notify);

let _resolveRuntime, _rejectRuntime;
let _runtimeReady = new Promise( (resolve,reject) => {
    _resolveRuntime = resolve;
    _rejectRuntime = reject;
});

async function loadRuntime() {
    return await _runtimeReady;
}

var Module = {
    print: function(text) { console.log('stdout: ' + text) },
    printErr: function(text) { console.log('stderr: ' + text) },
    noInitialRun: true,
    onRuntimeInitialized: function() {
        console.log('vw module initialized!');

        this.vw_alloc_example = Module.cwrap ('vw_alloc_example', 'number', []);
        this.vw_free_example = Module.cwrap ('vw_free_example', null, ['number']);

        this.vw_alloc_example_builder = Module.cwrap ('vw_alloc_example_builder', 'number', ['number', 'string']);
        this.vw_free_example_builder = Module.cwrap ('vw_free_example_builder', null, ['number']);
        this.vw_push_feature_string = Module.cwrap ('vw_push_feature_string', null, ['number', 'string', 'number']);

        this.vw_alloc_no_model = Module.cwrap ('vw_alloc_no_model', 'number', ['string']);
        this.vw_alloc_with_model = Module.cwrap ('vw_alloc_with_model', 'number', ['string', 'number', 'number']);
        this.vw_predict = Module.cwrap ('vw_predict', 'number', ['number', 'string', 'number', 'number', 'number']);

        this.vw_prediction_size = Module.cwrap ('vw_prediction_size', 'number', ['number']);
        this.vw_prediction_get_ranking = Module.cwrap ('vw_prediction_get_ranking', 'number', ['number', 'number']);
        this.vw_prediction_get_pdf = Module.cwrap ('vw_prediction_get_pdf', 'number', ['number', 'number']);        
        this.vw_free_prediction = Module.cwrap ('vw_free_prediction', null, ['number']); 

        _resolveRuntime(Module);
    },
    instantiateWasm: function(info, receiveInstance) {
        var wasmModuleUrl = browser.extension.getURL('vw.wasm');
        async function resolveModule() {
            try {
                let response = await fetch(wasmModuleUrl, { credentials: 'same-origin' });
                let wasmModule = await WebAssembly.instantiateStreaming(response, info);
                receiveInstance(wasmModule["instance"])
            } catch(e) {
                console.log('failed to fetch wasm module due to ' + e);
                _rejectRuntime(e);
            }
        };

        resolveModule();

        return { };
    }
}


let _vwModelFile = null;
function loadVWModel() {
    async function doLoad() {
        try {
            var vwModelUrl = browser.extension.getURL('sample.model');
            let response = await fetch(vwModelUrl, { credentials: 'same-origin' });
            let model = await response.arrayBuffer();
            console.log('vw model loaded');
            return model;
        } catch(e) {
            console.log('failed to fetch vw model due to ' + e);
        }
    }
    if(!_vwModelFile)
        _vwModelFile = doLoad();
    return _vwModelFile;
}

let _vwPredict = null;
function loadVwPredict() {
    async function doLoad() {
        try {
            console.log('loadVwPredict')
            let model = await loadVWModel();
            console.log('got model')
            await loadRuntime();
            console.log('go runtime')
            
            //FIXME use https://github.com/emscripten-core/emscripten/issues/5519 instead
            var ptr = Module._malloc(model.byteLength);
            var heapBytes = new Uint8Array(Module.HEAPU8.buffer, ptr, model.byteLength);
            heapBytes.set(new Uint8Array(model));
            // let vw = new rt.vw_predict(ptr, model.byteLength);
            //args for learning: "--quiet --cb_explore_adf --cb_sample --coin --epsilon 0.1 -b 12"
            let vw = Module.vw_alloc_with_model("--quiet --no_stdin --cb_sample ", ptr, model.byteLength);
            console.log("vw model loaded");
            return vw;
        } catch(e) {
            console.log('vw fail ' + e)
            throw e;
        }
    }
    if(!_vwPredict)
        _vwPredict = doLoad();
    return _vwPredict;
}

//start things in the background
loadVwPredict();