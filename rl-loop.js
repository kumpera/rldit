
// we keep up to N unjoined decisions before dropping them
const max_unjoined = 10
let unjoined_decisions = []

function record_decison(event_id, chosen_action, prob, context)
{
    unjoined_decisions.push( {
        event_id,
        chosen_action,
        prob,
        context
    });

    //since we learn from the same event multiple times, we simply keep N around
    while(unjoined_decisions.length > max_unjoined) {
        unjoined_decisions.shift();
    }
}

async function record_click(click_data)
{
    console.log('click: ' + JSON.stringify(click_data))
    event = unjoined_decisions.find(e => e.event_id == click_data.eventId)
    if(!event) {
        console.log('could not find event_id: ' + click_data.eventId);
        return;
    }
    // console.log('found an the event: ' + JSON.stringify(event));

    //figure out what happened
    let actions = event.context.actions;
    let action = actions.find(a => a.__id == click_data.actionId);

    if(!action) {
        console.log('could not find action_id ' + click_data.actionId);
        return;
    }

    // console.log('action found ' + JSON.stringify(action));
    var distance_weight = (actions.length - action.__ranking) / actions.length;
    var action_cost = distance_weight * (-1 + click_data.isLink ? -0.5 : 0);

    const vw_predict = await loadVwPredict();

    function learn_one(idx, cost, prob) {
        // console.log(`learning that action ${idx - 1} has cost ${cost}`)
        const { shared, actions, action_list } = create_vw_examples(event.context);

        vw_predict.learn(event.event_id, shared, action_list, idx, cost, prob);

        action_list.delete();
        actions.forEach(a => Module.destroy_example(a));
        Module.destroy_example(shared);
    }
    try {
        learn_one(event.chosen_action + 1, action_cost, event.prob);
        if(action.__ranking != 0)
            learn_one(action.__idx + 1, -1, action.__prob);

    } catch(e) {
        console.log('failed to learn ' + e)
        throw e
    }

    // console.log('learning done, move on');
}

function add_feature(ex_builder, name, value) {
    if(typeof value === "string" || value == null) {
        if(value)
            value = value.replace(new RegExp('[^a-zA-Z0-9]', "gm"), '_');
        ex_builder.push_feature_string(name + "=" + value, 1.0);
    }
    else {
        ex_builder.push_feature_string(name, value);
    }
}

function add_namespace(example, ns_name, ns_data)
{
    const builder = new Module.example_predict_builder(Module.get_inner_example_predict(example), ns_name);

    for(var feature in ns_data) {
        add_feature(builder, feature, ns_data[feature]);
    }

    builder.delete();
}

function create_vw_examples(request) {
    let shared = Module.new_example();

    for(var ns in request.shared) {
        add_namespace(shared, ns, request.shared[ns])
    }

    let actions = []

    for(var i = 0; i < request.actions.length; ++i) {
        let action = Module.new_example();
        // console.log("action " + i + ' 0x' + action.toString(16));
        var action_data = request.actions[i];

        for(var ns in action_data) {
            if(ns.startsWith("__")) //ignore metadata __idx and __id
                continue;
            // console.log(`action [${i}] ns ${ns}`);
            add_namespace(action, ns, action_data[ns])
        }
        actions.push(action);
    }
    let action_list = new Module.action_list();
    actions.forEach(a => action_list.add_action(a));    

    return { shared, actions, action_list };
}

async function make_rl_decision(request) {
    // console.log('make_rl_decision');
    if (!request || !(request.actions.length > 0)) {
        console.log("bad request data: " +JSON.stringify(request));
        throw new "bad request data";
    }
    try {
        const vw_predict = await loadVwPredict();

        const { shared, actions, action_list } = create_vw_examples(request);

        let event_id = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        let prediction = vw_predict.predict(event_id, shared, action_list);
        let ranking = prediction.get_ranking();
        let pdf = prediction.get_pdf();

        r = "ranking: ";
        p = "pdf: ";
        rank_a = []
        pdf_a = []
        for(var i = 0; i < ranking.size(); ++i) {
            r += ranking.get(i) + " ";
            p += pdf.get(i) + " ";
            rank_a.push(ranking.get(i))
            pdf_a.push(pdf.get(i));
            request.actions[ranking.get(i)].__ranking = i;
            request.actions[ranking.get(i)].__prob = pdf.get(i);
        }
        console.log(r);
        console.log(p);

        const res = {
            action: ranking.get(0),
            prob: pdf.get(0),
            event_id: event_id,
            ranking: rank_a,
            pdf: pdf_a
        };

        record_decison(event_id, ranking.get(0), pdf.get(0), request);
        ranking.delete();
        pdf.delete();
        prediction.delete();

        action_list.delete();
        actions.forEach(a => Module.destroy_example(a));
        Module.destroy_example(shared)

        best_a = -1;
        best_p = 0;
        for(var i  = 0; i < res.pdf.length; ++i) {
            if(res.pdf[i] > best_p) {
                best_p = res.pdf[i]
                best_a = res.ranking[i]
            }
        }
        console.log(`select action is ${res.action} with probability ${res.prob} best action ${best_a} with probability ${best_p}`)
        return res;
    }catch(e) {
        console.log('decision failed with ' + e);
        throw e;
    }
};

function notify(request, sender, sendResponse) {
    // console.log('got msg ' + request.kind);
    if(request.kind == 'decision') {
        return make_rl_decision(request.context);
    } else if(request.kind == 'click') {
        return record_click(request);
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
        console.log('vw module initialized');
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
    if(_vwModelFile)
        return _vwModelFile;
    _vwModelFile = new Promise(async (resolve,reject) => {
        try {
            var vwModelUrl = browser.extension.getURL('sample.model');
            let response = await fetch(vwModelUrl, { credentials: 'same-origin' });
            let model = await response.arrayBuffer();
            console.log('vw model loaded');
            resolve(model);
        } catch(e) {
            console.log('failed to fetch vw model due to ' + e);
            reject(e);
        }
    });
    return _vwModelFile;
}

let _vwPredict = null;
function loadVwPredict() {
    async function doLoad() {
        try {
            let model = await loadVWModel();
            await loadRuntime();
            
            //FIXME use https://github.com/emscripten-core/emscripten/issues/5519 instead
            // var ptr = Module._malloc(model.byteLength);
            // var heapBytes = new Uint8Array(Module.HEAPU8.buffer, ptr, model.byteLength);
            // heapBytes.set(new Uint8Array(model));
            // let vw = new Module.vw_predict(ptr, model.byteLength);
            let vw = new Module.vw_predict();
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