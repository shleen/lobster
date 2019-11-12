import { ProgramTest, SingleTranslationUnitTest, NoErrorsNoWarningsVerifier, NoBadRuntimeEventsVerifier } from "./verifiers";
import { CompilationNotesOutlet } from "../view/editors";

$(() => {
    var numTests = 0;
    var numTestsSuccessful = 0;

    var showTest = (test: ProgramTest) => {
        var programElem = $('<div class="col-xs-6"></div>');

        programElem.append("Translation Units: <br />");
        for(var name in test.program.translationUnits) {
            programElem.append("<code>" + name + "</code><br />");
        }

        programElem.append("Source Files: <br />");
        var filesElem = $("<pre></pre>");
        filesElem.hide();
        var showFilesButton = $('<button class="btn btn-primary">Show</button>');
        showFilesButton.click(function() {
            showFilesButton.html(showFilesButton.html() === "Show" ? "Hide" : "Show");
            filesElem.toggle();
        });
        programElem.append(showFilesButton);
        for (var name in test.program.sourceFiles) {
            var sourceFile = test.program.sourceFiles[name];
            filesElem.append(sourceFile.name + "\n" + sourceFile.text);
        }
        programElem.append(filesElem);


        var resultsElem = $('<div class="col-xs-6"></div>');
//            resultsElem.append(test.results.status);
//            resultsElem.append("<br />");
        var success = true;
        for(var i = 0; i < test.results.length; ++i) {
            var result = test.results[i];

            var statusElem = $("<span class='label'>"+result.status+"</span>");
            statusElem.addClass(result.status === "success" ? "label-success" : "label-danger");
            resultsElem.append(statusElem);
            resultsElem.append(" " + result.verifierName);
            resultsElem.append("<br />");
            resultsElem.append(result.message + "<br />");

            if (result.status !== "success") {
                success = false;
            }
        }
        let notesElem = $("<ul></ul>").appendTo(resultsElem);
        (new CompilationNotesOutlet(notesElem)).updateNotes(test.program);

        var testElem = $('<div class="container lobster-test-result"></div>');
        testElem.append("<h2>" + test.name + "</h2>");
        testElem.append(programElem);
        testElem.append(resultsElem);
        $("#regression_tests").append(testElem);

        ++numTests;
        if (success) {
            ++numTestsSuccessful;
        }
        $("#allTestsResults").html(numTestsSuccessful + "/" + numTests + " tests successful")
    };

    ProgramTest.setDefaultReporter(showTest);

    // Empty program


    // Empty main
    new SingleTranslationUnitTest(
        "Empty Main",
        "int main() { }",
        [
            new NoErrorsNoWarningsVerifier(),
            new NoBadRuntimeEventsVerifier()
        ]
    );

    // ---------- Basic Declaration Tests ----------

    var basicDeclarationTestCode =
        `int main() {
  // A variety of declartions, including pointers and references
  int var = 3;
  int *ptr = &var;
  int **ptr2 = &ptr;
  int ***ptr3 = &ptr2;
  int &ref = var;
  int &ref2 = ref;
  int *&ref_to_ptr = ptr;
  int var2 = var;
  int var3 = *ptr;
  int var4 = **ptr2;
  int var5 = ref;
  int var6 = *ref_to_ptr;

  // Check that they all have the same value
  assert(var == 3);
  assert(var2 == 3);
  assert(var3 == 3);
  assert(var4 == 3);
  assert(var5 == 3);
  assert(var6 == 3);

  // Check that they have same/different addresses as they should
  assert(ptr == &var);
  assert(&ref == &var);
  assert(&ref2 == &ref);
  assert(&var2 != &var);
  assert(&ref_to_ptr == &ptr);
  assert(&ref_to_ptr == ptr2);

  // change via reference, check that the change is reflected everywhere
  ref = 4;
  assert(ref == 4);
  assert(var == 4);
  assert(*ptr == 4);
  assert(*ref_to_ptr == 4);

  // change via pointer, check that the change is reflected everywhere
  *ptr = 5;
  assert(ref == 5);
  assert(var == 5);
  assert(*ptr == 5);
  assert(*ref_to_ptr == 5);

  // test basic declaration of arrays
  int arr[3];
  int arr2[4] = {1, 2, 3, 99};
  int *ptrArr[2];
  int *ptrArr2[3] = {ptr, *ptr2, ref_to_ptr};
  assert(arr2[2] == 3);
  assert(ptrArr2[0] == &var);

  arr2[3] = *ptrArr2[2];
  assert(arr2[3] == var);

}`;
    var fundamentalTypesToTest = ["int", "double", "char"];
    fundamentalTypesToTest.map(function(t) {
        new SingleTranslationUnitTest(
            "Basic Declaration Test - " + t,
            basicDeclarationTestCode.replace(/int/g, t),
            [
                new NoErrorsNoWarningsVerifier(),
                new NoBadRuntimeEventsVerifier()
            ]
        );
    });

    // ---------- Basic Statement Test ----------

    new SingleTranslationUnitTest(
        "Basic Statement Test",
        `int main() {
  int x = 3;
  int y = 4;

  // Basic tests for all statements
  if (x == 3) {
    ++x;
  }
  assert(x == 4);

  if (y == 10) {
    assert(false);
  }
  else {
    assert(true);
  }

  int count = 0;
  while (y > 0) {
    --y;
    ++count;
  }
  assert(y == 0);
  assert(count == 4);

  for(int i = 0; i < 10; ++i) {
    ++y;
  }
  assert(y == 10);

  int z = 3;
  do {
    z++;
  }
  while(z == 4);
  assert(z == 5);

  int a = 5;
  while (a > 0) {
    --a;
    if (a < 3) {
      break;
    }
  }
  assert(a == 2);

  for(; a < 10; ++a) {
    if (a > 3) {
      if (a > 4) {
        if (a == 5) {
          break;
        }
      }
    }
  }
  assert(a == 5);

  // Expression statements
  ++x;
  x;
  x == x;

  // Compound statement
  {
    int blah = x;
    x + 1;
    x = x + 1;
    assert(blah + 1 == x);
  }

  // Null statements
  ;;;
  {
    ;
    x + 1; ; y = 3;
  }

}`,
        [
            new NoErrorsNoWarningsVerifier(),
            new NoBadRuntimeEventsVerifier()
        ]
    );








        // ---------- Basic Expression Test ----------

    new SingleTranslationUnitTest(
        "Basic Expression Test",
        `int plus2(int x) {
  return x + 2;
}

int func(int x, int &y, int *z) {
  x = 2;
  y = 2;
  *z = 2;
  z = 0;
  return 2;
}

class TestClass {
public:
  int mem1;
  double mem2;
};

int main() {

  // Literals
  int a = 3;
  double b = 4.5;
  char c = 'x';
  bool d = true;
  a = 4;
  b = 83.4;
  c = 'a';
  d = false;

  // Identifiers implicitly tested in other tests

  // Parentheses
  int f = 5;
  int g = 10;
  assert(f + g * 2 == 25);
  assert((f + g) * 2 == 30);
  assert((f) + (((g)) + 2) * (2 == 25) == 5);

  // Subscript
  int arr_a[5] = {5, 6, 7, 8, 9};
  assert(arr_a[0] == 5);
  assert(arr_a[3] == 8);
  assert(arr_a[4] == 9);
  arr_a[0] = 10;
  int *ptr_a = &arr_a[1];
  assert(ptr_a[0] == 6);
  assert(ptr_a[-1] == 10);
  assert(ptr_a[2] == 8);
  assert(ptr_a == arr_a + 1);

  // Function call
  int h = plus2(3);
  assert(h == 5);
  assert(plus2(5) == 7);
  int i1 = 5;
  int i2 = 5;
  int i3 = 5;
  int *i3_ptr = &i3;
  int i4 = func(i1, i2, i3_ptr);
  assert(i1 == 5);
  assert(i2 == 2);
  assert(i3 == 2);
  assert(i4 == 2);
  assert(i3_ptr == &i3);

  // Function call with function pointer
  int (*func_ptr)(int, int&, int*) = func;
  int (*func_ptr2)(int, int&, int*) = &func;
  int (*func_ptr3)(int, int&, int*) = *func;
  i1 = i2 = i3 = 5;
  func_ptr(i1, i2, i3_ptr);
  assert(i1 == 5);
  assert(i2 == 2);
  assert(i3 == 2);
  assert(i4 == 2);
  assert(i3_ptr == &i3);
  i1 = i2 = i3 = 5;
  (*func_ptr)(i1, i2, i3_ptr);
  assert(i1 == 5);
  assert(i2 == 2);
  assert(i3 == 2);
  assert(i4 == 2);
  assert(i3_ptr == &i3);

  // Member access with . and ->
  TestClass j;
  j.mem1 = 5;
  j.mem2 = 4.5;
  assert(j.mem1 + 2 == 5 + 2);
  assert(j.mem2 + 2.1 == 4.5 + 2.1);
  TestClass *j_ptr = &j;
  j_ptr->mem1 = 2;
  j_ptr->mem2 = 3.14;
  assert(j_ptr->mem1 + 1 == 2 + 1);
  assert(j_ptr->mem2 + 0.99 == 3.14 + 0.99);

  // Increment/decrement
  int k = 5;
  assert(++k == 6);
  assert(k == 6);
  assert(k++ == 6);
  assert(k == 7);
  ++k = 10;
  assert(k == 10);

  int l = 5;
  assert(--l == 4);
  assert(l == 4);
  assert(l-- == 4);
  assert(l == 3);
  --l = 10;
  assert(l == 10);

  int m = 5;
  assert((++m)-- == 6);
  assert(m == 5);

  // Unary operators
  int n = 5;
  int n1 = +n; assert(n1 == 5);
  int n2 = +6; assert(n2 == 6);
  int n3 = -n; assert(n3 == -5);
  int n4 = -6; assert(n4 == -6);
  bool o = true;
  o = !o;
  assert(o == false);
  assert(!o);
  assert(!!!o);
  assert(!!true);

  // Address of and dereference
  int p = 5;
  int *p_ptr = &p;
  int &p_ref = p;
  assert(*p_ptr == p);
  assert(p_ptr == &p);
  assert(**&p_ptr == p);
  assert(*p_ptr = 10);
  assert(p == 10);

  // new/delete/delete[]
  int *q1 = new int(3);
  double *q2 = new double(4.5);
  double **q3 = new (double*)(q2);

  delete q1;
  delete *q3;
  delete q3;
}`,
        [
            new NoErrorsNoWarningsVerifier(),
            new NoBadRuntimeEventsVerifier()
        ]
    );

// strang test

    new SingleTranslationUnitTest(
        "Basic Strang Test",
        `class strang {
private:
  size_t _size;
  size_t _capacity;
  char * _data;

  strang()
    : _size(0), _capacity(0), _data(new char[1]) {
    _data[0] = '\0';
  }

  strang(const strang &other)
    : _size(other._size), _capacity(other._capacity),
      _data(new char[other._capacity]) {

    for(int i = 0; i < other._size; ++i) {
      _data[i] = other._data[i];
    }
  }

  strang(const char *cstr)
    : _size(0) {
    // Find length of c-style string
    while(*cstr) {
      ++cstr;
      ++_size;
    }

    // reset cstr pointer
    cstr -= _size;

    // copy chars
    _capacity = _size + 1;
    _data = new char[_capacity];
    while(*cstr) {
      *_data++ = *cstr++;
    }
    *_data = '\0';

    // reset data pointer
    _data -= _size;
  }

  ~strang() {
    delete[] _data;
  }
};
int main() {
  strang s1;
  char cstr[10] = "hello";
  for(int i = 0; i < 10-1; ++i) {
    cstr[i] = 'x';
  }
  strang s2(cstr);
  cout << "hello" << endl;
}`,
        [
            new NoErrorsNoWarningsVerifier(),
            new NoBadRuntimeEventsVerifier()
        ]
    );
});